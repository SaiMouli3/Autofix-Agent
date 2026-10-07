"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "./api";
import { useAppStore, useRangeParams } from "./store";
import type {
  AgentDetail, AgentSettings, ChatMessage, Citation, Dashboard, InsightsPage, ListResult, Me, Notification, Store,
} from "./types";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), staleTime: 5 * 60_000 });
}

function useScope() {
  const storeId = useAppStore((s) => s.storeId);
  const range = useRangeParams();
  return { storeId, range, key: [storeId, range.range, range.from, range.to] as const };
}

export function useDashboard() {
  const { range, key } = useScope();
  return useQuery({
    queryKey: ["dashboard", ...key],
    queryFn: ({ signal }) => api<Dashboard>(`/dashboard${qs(range)}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 90_000,
  });
}

export function useAgent(id: string) {
  const { range, key } = useScope();
  return useQuery({
    queryKey: ["agent", id, ...key],
    queryFn: ({ signal }) => api<AgentDetail>(`/agents/${id}${qs(range)}`, { signal }),
    placeholderData: (prev, q) => (q?.queryKey[1] === id ? prev : undefined),
    refetchInterval: 120_000,
  });
}

export function useAgents() {
  const { range, key } = useScope();
  return useQuery({
    queryKey: ["agents", ...key],
    queryFn: ({ signal }) => api<{ agents: Dashboard["agents"]; business: Dashboard["business"]; activity: Dashboard["activity"] }>(`/agents${qs(range)}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 90_000,
  });
}

export function useInsights() {
  const { range, key } = useScope();
  return useQuery({
    queryKey: ["insights", ...key],
    queryFn: ({ signal }) => api<InsightsPage>(`/insights${qs(range)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useNotifications() {
  const storeId = useAppStore((s) => s.storeId);
  return useQuery({
    queryKey: ["notifications", storeId],
    queryFn: () => api<{ notifications: Notification[]; unread: number }>("/notifications"),
    refetchInterval: 60_000,
  });
}

export function useList(endpoint: string, params: Record<string, string | number | undefined>, enabled = true) {
  const storeId = useAppStore((s) => s.storeId);
  return useQuery({
    queryKey: ["list", endpoint, storeId, params],
    queryFn: ({ signal }) => api<ListResult>(`/${endpoint}/list${qs(params)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProduct(id?: string) {
  const storeId = useAppStore((s) => s.storeId);
  return useQuery({
    queryKey: ["product", storeId, id],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: () => api<any>(`/products/${id}`),
    enabled: !!id,
  });
}

export function useCustomer(id?: string) {
  const storeId = useAppStore((s) => s.storeId);
  return useQuery({
    queryKey: ["customer", storeId, id],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: () => api<any>(`/customers/${id}`),
    enabled: !!id,
  });
}

/** Invalidate everything that depends on agent analysis. */
export function useInvalidateAnalysis() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["dashboard", "agent", "agents", "insights", "notifications", "list"]) qc.invalidateQueries({ queryKey: [k] });
  };
}

export function useUpdateInsight() {
  const invalidate = useInvalidateAnalysis();
  return useMutation({
    mutationFn: (v: { id: string; status: string; assignee?: string; agentId?: string; title?: string }) =>
      api(`/insights/${v.id}`, { method: "PATCH", body: v }),
    onSuccess: invalidate,
  });
}

export function useCreateAction() {
  const invalidate = useInvalidateAnalysis();
  return useMutation({
    mutationFn: (v: { kind: string; agentId: string; insightId?: string; detail?: string }) => api("/actions", { method: "POST", body: v }),
    onSuccess: invalidate,
  });
}

export function useAgentSettings(id: string) {
  const invalidate = useInvalidateAnalysis();
  return useMutation({
    mutationFn: (s: AgentSettings) => api<{ settings: AgentSettings }>(`/agents/${id}/settings`, { method: "PATCH", body: s }),
    onSuccess: invalidate,
  });
}

export function useMarkNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: "read" | "dismiss"; ids?: string[]; all?: boolean }) =>
      api(`/notifications/${v.action}`, { method: "POST", body: { ids: v.ids ?? [], all: v.all ?? false } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useCreateStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { platform: string; businessType: string; name?: string }) => api<{ store: Store }>("/stores", { method: "POST", body: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useChat() {
  const range = useAppStore((s) => s.range);
  return useMutation({
    mutationFn: (messages: ChatMessage[]) =>
      api<{ answer: string; citations: Citation[]; suggestions: string[]; engine: string }>("/ai/chat", {
        method: "POST",
        body: { messages: messages.map(({ role, content }) => ({ role, content })), range: range === "custom" ? "30d" : range },
      }),
  });
}
