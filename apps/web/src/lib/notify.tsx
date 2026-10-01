import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

type Notify = (message: string, tone?: Tone) => void;

const NotifyContext = createContext<Notify>(() => undefined);

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback<Notify>(
    (message, tone = "success") => setToast({ id: Date.now(), message, tone }),
    []
  );
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.tone === "error" ? 5000 : 3200
    );
    return () => window.clearTimeout(timer);
  }, [toast]);
  const Icon =
    toast?.tone === "error"
      ? AlertCircle
      : toast?.tone === "info"
        ? Info
        : CheckCircle2;
  const value = useMemo(() => notify, [notify]);
  return (
    <NotifyContext.Provider value={value}>
      {children}
      {toast && (
        <div
          key={toast.id}
          className="toast"
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <Icon
            size={15}
            className={`mr-2 inline ${toast.tone === "error" ? "text-[#f3b1a8]" : "text-[#9ad2b9]"}`}
          />
          {toast.message}
        </div>
      )}
    </NotifyContext.Provider>
  );
}

export const useNotify = () => useContext(NotifyContext);
