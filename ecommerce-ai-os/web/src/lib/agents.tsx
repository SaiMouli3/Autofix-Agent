import {
  Boxes, Headset, Landmark, Megaphone, Newspaper, Package, Sparkles, Star, Tag, Truck, Users, type LucideIcon,
} from "lucide-react";
import type { AgentId, Severity } from "./types";

export interface AgentMeta {
  id: AgentId;
  name: string;
  short: string;
  icon: LucideIcon;
  /** Restrained identity accent: used only for the agent's dot and icon tint. */
  hue: string;
}

// Accents use the validated categorical series so agent identity stays
// colour-blind safe, and never borrows a status colour.
export const AGENTS: AgentMeta[] = [
  { id: "orders", name: "Order & Delivery Agent", short: "Orders & Delivery", icon: Truck, hue: "var(--series-1)" },
  { id: "customers", name: "Customer Agent", short: "Customers", icon: Users, hue: "var(--series-3)" },
  { id: "reviews", name: "Review & Reputation Agent", short: "Reviews", icon: Star, hue: "var(--series-4)" },
  { id: "support", name: "Complaint & Support Agent", short: "Support", icon: Headset, hue: "var(--series-5)" },
  { id: "products", name: "Product Intelligence Agent", short: "Products", icon: Package, hue: "var(--series-2)" },
  { id: "inventory", name: "Inventory Agent", short: "Inventory", icon: Boxes, hue: "var(--series-6)" },
  { id: "pricing", name: "Pricing & Competitor Agent", short: "Pricing", icon: Tag, hue: "var(--series-8)" },
  { id: "marketing", name: "Marketing Agent", short: "Marketing", icon: Megaphone, hue: "var(--series-7)" },
  { id: "finance", name: "Finance Agent", short: "Finance", icon: Landmark, hue: "var(--series-1)" },
  { id: "market", name: "Market & News Agent", short: "Market & News", icon: Newspaper, hue: "var(--series-3)" },
];

export const BUSINESS_AGENT: AgentMeta = { id: "insights", name: "Business Insights Agent", short: "Business Insights", icon: Sparkles, hue: "var(--accent)" };

export function agentMeta(id: string): AgentMeta {
  if (id === "insights") return BUSINESS_AGENT;
  return AGENTS.find((a) => a.id === id) ?? BUSINESS_AGENT;
}

export function agentHref(id: string) {
  return id === "insights" ? "/insights" : `/agents/${id}`;
}

export const SEVERITY: Record<Severity, { label: string; text: string; soft: string; dot: string; rank: number }> = {
  critical: { label: "Critical", text: "text-crit-text", soft: "bg-crit-soft", dot: "bg-crit", rank: 0 },
  important: { label: "Important", text: "text-warn-text", soft: "bg-warn-soft", dot: "bg-warn", rank: 1 },
  opportunity: { label: "Opportunity", text: "text-good-text", soft: "bg-good-soft", dot: "bg-good", rank: 2 },
  market: { label: "Market", text: "text-info-text", soft: "bg-info-soft", dot: "bg-info", rank: 3 },
  info: { label: "Informational", text: "text-fg-2", soft: "bg-surface-3", dot: "bg-fg-3", rank: 4 },
};

export const STATUS_LABEL: Record<string, string> = {
  monitoring: "Monitoring",
  analyzing: "Analyzing",
  attention: "Attention required",
  connection_issue: "Data connection issue",
  paused: "Paused",
};
