export function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function dateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function time(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function duration(sec?: number | null): string {
  if (sec === null || sec === undefined) return "—";
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function num(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function usd(n?: number | null): string {
  if (n === null || n === undefined) return "n/a";
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function bytes(n?: number | null): string {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_LABEL: Record<string, string> = {
  configured: "Configured",
  draft: "Draft",
  idle: "Idle",
  active: "Active",
  queued: "Queued",
  running: "Running",
  waiting_for_approval: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
  disabled: "Disabled",
  offline: "Offline",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  proposed: "Proposed",
  indexed: "Indexed",
  processing: "Processing",
  ok: "Healthy",
  error: "Error",
  untested: "Untested",
};
