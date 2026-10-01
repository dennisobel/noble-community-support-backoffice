export { formatMoney as money } from "@shared/logic/money";
export {
  prettyDate,
  shortDate,
  planLabel,
  durationHours,
  formatDuration,
} from "@shared/logic/time";
export { initialsOf as initials, formatNdis } from "@shared/logic/ndis";

export function statusClass(status: string): string {
  switch (status) {
    case "Approved":
    case "Paid":
    case "Active":
    case "Confirmed":
    case "Ready":
    case "Draft ready":
      return "badge-approved";
    case "Invoiced":
    case "Completed":
      return "badge-invoiced";
    case "Submitted":
    case "Sent":
    case "Ready to send":
    case "Planned":
    case "Processing":
      return "badge-submitted";
    case "Returned":
    case "On leave":
    case "Low balance":
      return "badge-returned";
    case "Void":
    case "Cancelled":
    case "Over allocation":
    case "Plan expired":
    case "Failed":
    case "Unavailable":
      return "badge-danger";
    default:
      return "badge-draft";
  }
}

export function statusIcon(status: string): string {
  switch (status) {
    case "Approved":
    case "Paid":
      return "✓";
    case "Returned":
      return "!";
    case "Submitted":
    case "Sent":
      return "↗";
    case "Invoiced":
      return "▤";
    case "Void":
    case "Cancelled":
      return "×";
    default:
      return "•";
  }
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "just now", "5 min ago", "today, 12:08 pm", "yesterday, 3:32 pm", "18 Sep" */
export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const time = date
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  if (date >= startOfToday) return `today, ${time}`;
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  if (date >= startOfYesterday) return `yesterday, ${time}`;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  return hour < 12
    ? "Good morning"
    : hour < 17
      ? "Good afternoon"
      : "Good evening";
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Splits a textarea into trimmed, non-empty lines. */
export const lines = (text: string) =>
  text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
