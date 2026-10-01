import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

const GL_VERSION = "3.9.0";
const CDN = `https://api.mapbox.com/mapbox-gl-js/v${GL_VERSION}/mapbox.gl.js`;
const CSS = `https://api.mapbox.com/mapbox-gl-js/v${GL_VERSION}/mapbox-gl.css`;

/** The handful of Mapbox API calls this component needs (loaded from the CDN). */
interface MapboxSource {
  setData: (data: unknown) => void;
}
interface MapboxMap {
  addSource: (name: string, source: object) => void;
  getSource: (name: string) => MapboxSource | undefined;
  addLayer: (layer: object) => void;
  easeTo: (options: object) => void;
  remove: () => void;
}
interface MapboxGl {
  accessToken?: string;
  Map: new (options: object) => MapboxMap;
}

declare global {
  interface Window {
    mapboxgl?: MapboxGl;
  }
}

let loading: Promise<MapboxGl | null> | null = null;

/**
 * Loads Mapbox GL JS from Mapbox's CDN on first use — no npm dependency and no
 * bundle cost for pages that never draw a map. Resolves to `null` when no
 * `VITE_MAPBOX_TOKEN` is configured, so the UI can fall back gracefully.
 */
function loadMapbox(): Promise<MapboxGl | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
  if (!token) return Promise.resolve(null);
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  if (loading) return loading;
  loading = (async () => {
    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS;
      document.head.appendChild(link);
    }
    if (!window.mapboxgl) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = CDN;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Mapbox failed to load"));
        document.head.appendChild(script);
      });
    }
    window.mapboxgl!.accessToken = token;
    return window.mapboxgl!;
  })().catch(error => {
    loading = null;
    throw error;
  });
  return loading;
}

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
}

interface Props {
  trail: Array<{ lat: number; lng: number }>;
  markers?: MapMarker[];
  height?: number;
  follow?: boolean;
  emptyText?: string;
}

/** Draws the worker's live trail (and the start/end points) on a Mapbox map. */
export default function TrackingMap({
  trail,
  markers = [],
  height = 260,
  follow = true,
  emptyText = "No location recorded yet.",
}: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);

  // The map is created once; every data change is applied to the source below.
  useEffect(() => {
    let disposed = false;
    void loadMapbox()
      .then(gl => {
        if (disposed || !holder.current) return;
        // No token configured: fall back to the explanation rather than loading forever.
        if (!gl) return setReady(false);
        mapRef.current = new gl.Map({
          container: holder.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [138.6, -34.92],
          zoom: 10,
          attributionControl: { compact: true },
        });
        setReady(true);
      })
      .catch(() => setReady(false));
    return () => {
      disposed = true;
      try {
        mapRef.current?.remove();
      } catch {
        /* already gone */
      }
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || ready !== true) return;
    const points = [
      ...trail.map((point, index) => ({
        type: "Feature" as const,
        properties: { role: index === 0 ? "start" : "live" },
        geometry: {
          type: "Point" as const,
          coordinates: [point.lng, point.lat],
        },
      })),
      ...markers.map(marker => ({
        type: "Feature" as const,
        properties: { role: marker.label ?? "pin" },
        geometry: {
          type: "Point" as const,
          coordinates: [marker.lng, marker.lat],
        },
      })),
    ];
    const data = {
      type: "FeatureCollection",
      features: [
        ...(trail.length > 1
          ? [
              {
                type: "Feature" as const,
                properties: { role: "trail" },
                geometry: {
                  type: "LineString" as const,
                  coordinates: trail.map(point => [point.lng, point.lat]),
                },
              },
            ]
          : []),
        ...points,
      ],
    };
    if (!map.getSource("data")) {
      map.addSource("data", { type: "geojson", data });
      map.addLayer({
        id: "trail-casing",
        type: "line",
        source: "data",
        filter: ["==", "geometry-type", "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#0f8b8d",
          "line-width": 8,
          "line-opacity": 0.22,
        },
      });
      map.addLayer({
        id: "trail",
        type: "line",
        source: "data",
        filter: ["==", "geometry-type", "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#147f79", "line-width": 4 },
      });
      map.addLayer({
        id: "pins",
        type: "circle",
        source: "data",
        filter: ["==", "geometry-type", "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "match",
            ["get", "role"],
            "start",
            "#276696",
            "live",
            "#147f79",
            "#a84540",
          ],
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });
    } else {
      map.getSource("data")?.setData(data);
    }

    const last = trail[trail.length - 1];
    if (last && follow)
      map.easeTo({ center: [last.lng, last.lat], duration: 800 });
    else if (markers.length)
      map.easeTo({
        center: [markers[0]!.lng, markers[0]!.lat],
        duration: 400,
      });
  }, [trail, markers, ready, follow]);

  return (
    <div className="map-holder" style={{ height }}>
      <div ref={holder} className="map-canvas" />
      {ready === null && <div className="map-overlay">Loading map…</div>}
      {ready === false && (
        <div className="map-overlay">
          <MapPin size={18} />
          <p className="mt-2 max-w-[300px] text-center text-xs leading-5">
            Live map unavailable. Set <code>VITE_MAPBOX_TOKEN</code> to draw the
            route — your positions and kilometres are still being recorded.
          </p>
        </div>
      )}
      {ready === true && !trail.length && !markers.length && (
        <div className="map-overlay">{emptyText}</div>
      )}
    </div>
  );
}
