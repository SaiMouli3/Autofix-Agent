import { useEffect, useRef, useState } from "react";

export interface ActivityEvent {
  id: number;
  task_id: string;
  agent_id: string;
  ts: string;
  type: string;
  summary: string;
  data: Record<string, any>;
}

/** Server-sent activity stream. EventSource reconnects automatically and resumes from the
 *  last event id; duplicates are dropped by id. Returns connection state for the UI. */
export function useActivityStream(onEvent: (e: ActivityEvent) => void, filter: { taskId?: string; agentId?: string } = {}, enabled = true) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const [state, setState] = useState<"connecting" | "live" | "reconnecting">("connecting");
  useEffect(() => {
    if (!enabled) return;
    const p = new URLSearchParams();
    if (filter.taskId) p.set("task_id", filter.taskId);
    if (filter.agentId) p.set("agent_id", filter.agentId);
    const seen = new Set<number>();
    const es = new EventSource(`/api/stream?${p.toString()}`, { withCredentials: true });
    es.onopen = () => setState("live");
    es.onerror = () => setState("reconnecting");
    es.addEventListener("activity", (msg) => {
      try {
        const ev = JSON.parse((msg as MessageEvent).data) as ActivityEvent;
        if (seen.has(ev.id)) return;
        seen.add(ev.id);
        cb.current(ev);
      } catch {
        /* ignore malformed frames */
      }
    });
    return () => es.close();
  }, [filter.taskId, filter.agentId, enabled]);
  return state;
}
