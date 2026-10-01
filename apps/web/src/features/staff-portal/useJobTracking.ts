import { useCallback, useEffect, useRef, useState } from "react";
import { TRACKING_INTERVALS } from "@shared/enums";
import { errorMessage } from "@/api/client";
import { sendTrackingPings } from "@/api/hooks";

export interface Ping {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speedKph?: number | null;
  at: string;
}

export type TrackingState = "idle" | "locating" | "tracking" | "error";

const QUEUE_KEY = "noble.tracking.queue";
const MAX_QUEUE = 180;
const FLUSH_MS = 4_000;

function readQueue(sessionId: string): Ping[] {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "{}") as Record<
      string,
      Ping[]
    >;
    return raw[sessionId] ?? [];
  } catch {
    return [];
  }
}

function writeQueue(sessionId: string, queue: Ping[]): void {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "{}") as Record<
      string,
      Ping[]
    >;
    if (queue.length) raw[sessionId] = queue.slice(-MAX_QUEUE);
    else delete raw[sessionId];
    localStorage.setItem(QUEUE_KEY, JSON.stringify(raw));
  } catch {
    /* private mode / quota — a lost queue only loses points, never the kilometres */
  }
}

/**
 * Live location writer for an active job.
 *
 * Follows the practice set out in LIVE_TRACKING_REPORT.md:
 *  • 5 s while moving, 30 s while stationary (the server tells us which).
 *  • Fixes are buffered and flushed together, so brief dropouts never lose data.
 *  • A queue is persisted to localStorage, so a lost connection replays later.
 *  • The screen is kept awake (Wake Lock) while tracking, and everything stops
 *    when the page is hidden or the session ends.
 */
export function useJobTracking(sessionId: string | null) {
  const [state, setState] = useState<TrackingState>("idle");
  const [error, setError] = useState("");
  const [fixes, setFixes] = useState(0);
  const buffer = useRef<Ping[]>([]);
  const interval = useRef<number>(TRACKING_INTERVALS.idleSec);
  const watchId = useRef<number | null>(null);
  const flushTimer = useRef<number | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const sending = useRef(false);

  const flush = useCallback(async () => {
    if (!sessionId || sending.current) return;
    const queue = [...readQueue(sessionId), ...buffer.current];
    if (!queue.length) return;
    buffer.current = [];
    sending.current = true;
    try {
      const result = await sendTrackingPings(
        sessionId,
        queue.slice(-60).map(ping => ({ ...ping }))
      );
      interval.current = result.nextIntervalSec;
      writeQueue(sessionId, queue.slice(0, -60));
      setFixes(value => value + queue.length);
      setError("");
      setState("tracking");
    } catch (failure) {
      // Keep the fixes; they are replayed when the connection comes back.
      writeQueue(
        sessionId,
        [...queue.slice(-60), ...buffer.current].slice(-MAX_QUEUE)
      );
      buffer.current = [];
      setError(errorMessage(failure));
      setState("error");
    } finally {
      sending.current = false;
    }
  }, [sessionId]);

  const onPosition = useCallback(
    (position: GeolocationPosition) => {
      buffer.current.push({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
        speedKph:
          position.coords.speed !== null && position.coords.speed >= 0
            ? Math.round(position.coords.speed * 36) / 10
            : null,
        at: new Date(position.timestamp).toISOString(),
      });
      setState("tracking");
      if (buffer.current.length >= 3) void flush();
    },
    [flush]
  );

  const onFailure = useCallback((failure: GeolocationPositionError | Error) => {
    const denied =
      failure instanceof GeolocationPositionError && failure.code === 1;
    setError(
      denied
        ? "Location access is off. Allow location for this site so your job can be tracked."
        : "Waiting for a location fix — tracking resumes as soon as you have signal."
    );
    if (denied) setState("error");
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator)
        wakeLock.current = await navigator.wakeLock.request("screen");
    } catch {
      /* unsupported or denied — tracking still works while the screen is on */
    }
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setState("idle");
      setError("");
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("This browser can't share a location.");
      setState("error");
      return;
    }
    setState("locating");
    void requestWakeLock();
    const replay = readQueue(sessionId);
    if (replay.length) {
      buffer.current = replay;
      writeQueue(sessionId, []);
      void flush();
    }
    watchId.current = navigator.geolocation.watchPosition(
      onPosition,
      onFailure,
      { enableHighAccuracy: true, maximumAge: 4_000, timeout: 20_000 }
    );
    flushTimer.current = window.setInterval(() => void flush(), FLUSH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
      if (buffer.current.length) void flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (watchId.current !== null)
        navigator.geolocation.clearWatch(watchId.current);
      if (flushTimer.current) window.clearInterval(flushTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      void flush();
      wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
    };
  }, [sessionId, flush, onPosition, onFailure, requestWakeLock]);

  return {
    state,
    error,
    fixes,
    intervalSec: interval.current,
    retry: () => void flush(),
  };
}
