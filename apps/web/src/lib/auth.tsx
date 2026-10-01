import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { Redirect, useLocation } from "wouter";
import type { SessionDTO } from "@shared/dto";
import { api, ApiError, onSessionExpired } from "@/api/client";

interface AuthValue {
  session: SessionDTO | null;
  loading: boolean;
  /** Stores the session returned by login/signup/demo. */
  signedIn: (session: SessionDTO) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const SESSION_KEY = ["session"];

async function loadSession(): Promise<SessionDTO | null> {
  try {
    return await api.get<SessionDTO>("/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: loadSession,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const clearAndLeave = useCallback(
    (path: string) => {
      qc.cancelQueries();
      qc.removeQueries({
        predicate: q =>
          q.queryKey[0] !== "meta" && q.queryKey[0] !== "bootstrap",
      });
      qc.setQueryData(SESSION_KEY, null);
      navigate(path, { replace: true });
    },
    [qc, navigate]
  );

  useEffect(
    () =>
      onSessionExpired(() => {
        if (qc.getQueryData(SESSION_KEY)) clearAndLeave("/login?expired=1");
      }),
    [qc, clearAndLeave]
  );

  const value = useMemo<AuthValue>(
    () => ({
      session: query.data ?? null,
      loading: query.isPending,
      signedIn: session => qc.setQueryData(SESSION_KEY, session),
      signOut: async () => {
        try {
          await api.post("/auth/logout");
        } finally {
          clearAndLeave("/login");
        }
      },
    }),
    [query.data, query.isPending, qc, clearAndLeave]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function FullScreenLoader({
  label = "Loading Noble…",
}: {
  label?: string;
}) {
  return (
    <div
      className="grid min-h-screen place-items-center bg-[#f7f8f6]"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-xs text-[#6e7b86]">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-[#cfe1dc] border-t-[#147f79]" />
        {label}
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const [location] = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!session)
    return <Redirect to={`/login?next=${encodeURIComponent(location)}`} />;
  return <>{children}</>;
}

/** Sends workers to their portal and Admins to the back office. */
export const homeFor = (role?: string) =>
  role === "staff" ? "/staff" : "/app";

/** Route guard: signs the user out of the section they are not allowed in. */
export function RequireRole({
  role,
  children,
}: {
  role: "admin" | "staff";
  children: ReactNode;
}) {
  const { session, loading } = useAuth();
  const [location] = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!session)
    return <Redirect to={`/login?next=${encodeURIComponent(location)}`} />;
  if (session.user.role !== role)
    return <Redirect to={homeFor(session.user.role)} />;
  return <>{children}</>;
}
