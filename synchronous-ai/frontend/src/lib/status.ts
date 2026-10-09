/** Single source of truth for how states are named, toned and symbolised. Tone is never the only cue. */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";
export type Sym = "running" | "check" | "x" | "clock" | "pause" | "minus" | "alert" | "circle" | "dot";

export const STATUS: Record<string, { label: string; tone: Tone; sym: Sym }> = {
  // tasks
  queued: { label: "Queued", tone: "neutral", sym: "clock" },
  running: { label: "Running", tone: "info", sym: "running" },
  waiting_for_approval: { label: "Needs approval", tone: "warning", sym: "pause" },
  completed: { label: "Completed", tone: "success", sym: "check" },
  failed: { label: "Failed", tone: "danger", sym: "x" },
  timed_out: { label: "Timed out", tone: "danger", sym: "clock" },
  cancelled: { label: "Cancelled", tone: "neutral", sym: "minus" },
  // agents
  idle: { label: "Idle", tone: "neutral", sym: "circle" },
  active: { label: "Active", tone: "success", sym: "dot" },
  draft: { label: "Draft", tone: "neutral", sym: "circle" },
  disabled: { label: "Disabled", tone: "neutral", sym: "minus" },
  // approvals
  pending: { label: "Pending", tone: "warning", sym: "pause" },
  approved: { label: "Approved", tone: "success", sym: "check" },
  rejected: { label: "Rejected", tone: "danger", sym: "x" },
  expired: { label: "Expired", tone: "neutral", sym: "clock" },
  // integrations / providers
  connected: { label: "Connected", tone: "success", sym: "check" },
  disconnected: { label: "Disconnected", tone: "neutral", sym: "minus" },
  misconfigured: { label: "Misconfigured", tone: "warning", sym: "alert" },
  needs_signin: { label: "Not signed in", tone: "warning", sym: "alert" },
  error: { label: "Error", tone: "danger", sym: "x" },
  untested: { label: "Not tested", tone: "neutral", sym: "circle" },
  proposed: { label: "Awaiting review", tone: "warning", sym: "pause" },
  ok: { label: "Connected", tone: "success", sym: "check" },
  // knowledge
  pending_doc: { label: "Uploaded", tone: "neutral", sym: "clock" },
  processing: { label: "Processing", tone: "info", sym: "running" },
  indexed: { label: "Indexed", tone: "success", sym: "check" },
  succeeded: { label: "Succeeded", tone: "success", sym: "check" },
};

export const statusOf = (s: string) => STATUS[s] ?? { label: s.replace(/_/g, " "), tone: "neutral" as Tone, sym: "circle" as Sym };

export const ACTIVE_TASK_STATES = ["queued", "running", "waiting_for_approval"];
export const TERMINAL_TASK_STATES = ["completed", "failed", "timed_out", "cancelled"];

/** Failure taxonomy (server classifies; this maps to wording and the next action). */
export const FAILURE: Record<string, { label: string; next: string }> = {
  provider: { label: "Provider failure", next: "Check the model provider's status and credentials in Settings, then retry." },
  tool: { label: "Tool failure", next: "Open the activity log to see which tool failed, then retry or adjust the instructions." },
  timeout: { label: "Execution timeout", next: "Increase the agent's task timeout or split the task into smaller steps." },
  permission: { label: "Permission denied", next: "Review the agent's tools, integrations and approval policy." },
  cancelled: { label: "Cancelled", next: "Resubmit the task if the work is still needed." },
  limit: { label: "Limit reached", next: "The budget, iteration or tool-call limit stopped the run. Adjust the policy or narrow the task." },
  infrastructure: { label: "Infrastructure failure", next: "The worker or sandbox was lost. Retry; contact an administrator if it repeats." },
  runtime: { label: "Agent runtime error", next: "Inspect the activity log, then retry." },
};

export function integrationState(i: any): "connected" | "disconnected" | "misconfigured" | "needs_signin" | "error" | "untested" | "proposed" {
  if (i.status === "disabled") return "disconnected";
  const needsCred = i.oauth ? true : i.type === "http" ? (i.config?.auth?.type ?? "none") !== "none" : false;
  const invalid = (i.validation ?? []).some((c: any) => !c.ok && c.severity === "error");
  if (invalid) return "misconfigured";
  if (i.oauth && !i.oauth.connected) return "needs_signin";
  if (needsCred && !i.has_credential) return "misconfigured";
  if (i.health?.checked_at && !i.health.ok) return "error";
  if (i.status === "proposed") return "proposed";
  if (!i.health?.checked_at) return "untested";
  return "connected";
}

export function providerState(p: any): "connected" | "misconfigured" | "error" | "untested" {
  if (!p.has_credential || !p.default_model) return "misconfigured";
  if (p.status === "ok") return "connected";
  if (p.status === "error") return "error";
  return "untested";
}
