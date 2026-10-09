import { useEffect, useRef } from "react";

export interface ActivityEvent {
  id: number;
  task_id: string;
  agent_id: string;
  ts: string;
  type: string;
  summary: string;
  data: Record<string, any>;
}

/** Subscribe to the server-sent activity stream (auto-reconnects via EventSource). */
export function useActivityStream(
  onEvent: (e: ActivityEvent) => void,
  filter: { taskId?: string; agentId?: string } = {},
  enabled = true,
) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (!enabled) return;
    const p = new URLSearchParams();
    if (filter.taskId) p.set("task_id", filter.taskId);
    if (filter.agentId) p.set("agent_id", filter.agentId);
    const es = new EventSource(`/api/stream?${p.toString()}`, { withCredentials: true });
    es.addEventListener("activity", (msg) => {
      try {
        cb.current(JSON.parse((msg as MessageEvent).data));
      } catch {
        /* ignore malformed */
      }
    });
    return () => es.close();
  }, [filter.taskId, filter.agentId, enabled]);
}
