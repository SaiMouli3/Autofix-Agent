// API contract types — mirror the Go API (internal/agents, internal/httpapi).

export type Severity = "critical" | "important" | "opportunity" | "market" | "info";
export type AgentId =
  | "orders" | "customers" | "reviews" | "support" | "products"
  | "inventory" | "pricing" | "marketing" | "finance" | "market" | "insights";
export type AgentStatus = "monitoring" | "analyzing" | "attention" | "connection_issue" | "paused";

export interface User { id: string; orgId: string; name: string; email: string; role: string; createdAt: string }
export interface Store { id: string; orgId: string; name: string; platform: string; businessType: string; currency: string; seededAt: string; createdAt: string }
export interface Me { user: User; organization: { id: string; name: string } | null; stores: Store[]; llm: { enabled: boolean; model: string } }

export interface Range {
  key: string; label: string; from: string; to: string; prevFrom: string; prevTo: string; granularity: "hour" | "day" | "week";
}

export interface KPI {
  key: string; label: string; value: number; prev: number; change: number;
  unit: string; direction: "up" | "down" | "neutral"; spark?: number[]; hint?: string; href?: string;
}

export interface Evidence { label: string; value: string; change?: number; unit?: "pct" | "pts" | ""; tone?: "bad" | "good" | "neutral" }
export interface Action { label: string; intent: "investigate" | "view" | "assign" | "dismiss" | "apply" | "generate"; href?: string }
export interface EntityRef { type: string; id: string; name: string }

export interface Insight {
  id: string; agentId: AgentId; severity: Severity; title: string; summary: string;
  evidence: Evidence[]; likelyCause?: string; impact?: string; impactValue: number;
  recommendation: string; actions: Action[]; entity?: EntityRef; detectedAt: string;
  confidence: number; sources?: AgentId[]; status: "new" | "assigned" | "dismissed" | "resolved"; assignee?: string;
}

export interface Step { agentId: AgentId; insightId: string; finding: string }
export interface BusinessInsight extends Insight {
  observation: string; chain: Step[]; whyChanged: string; category: "risk" | "opportunity" | "what-changed"; sourceInsights: string[];
}

export interface Activity { id: string; agentId: AgentId; at: string; kind: "detection" | "scan" | "recommendation" | "sync" | "action"; message: string; severity?: Severity; insightId?: string }

export interface AgentSummary {
  id: AgentId; name: string; shortName: string; question: string; description: string; icon: string;
  dataSources: string[]; responsibilities: string[];
  status: AgentStatus; health: number; healthPrev: number; healthLabel: string; lastAnalysis: string;
  issues: number; opportunities: number; recommendations: number;
  headline: { label: string; value: number; unit: string }; recordsAnalyzed: number;
}

export interface Change { label: string; cur: number; prev: number; change: number; unit: string; direction: string; note?: string }

export interface HealthSegment { key: string; label: string; score: number; prev: number; href: string; agents: AgentId[] }

export interface Dashboard {
  range: Range; store: { id: string; name: string }; generatedAt: string; analysisMs: number;
  health: { score: number; prev: number; change: number; label: string; segments: HealthSegment[] };
  kpis: KPI[]; trend: Array<{ t: string; revenue: number; prevRevenue: number; orders: number }>;
  priority: BusinessInsight[]; priorityCounts: Partial<Record<Severity, number>>;
  agents: AgentSummary[]; business: AgentSummary; activity: Activity[];
}

export interface AgentSettings {
  paused: boolean; sensitivity: "low" | "balanced" | "high";
  notify: Record<string, boolean>; thresholds: Record<string, number>; digest: "realtime" | "daily" | "weekly";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type View = Record<string, any>;

export interface AgentDetail {
  range: Range; summary: AgentSummary; view: View; changes: Change[] | null; insights: Insight[];
  activity: Activity[]; settings: AgentSettings;
}

export interface InsightsPage {
  range: Range; summary: AgentSummary; brief: string; briefEngine: string; insights: BusinessInsight[];
  groups: Partial<Record<Severity, number>>;
  changes: Array<{ agentId: AgentId; label: string; cur: number; prev: number; change: number; unit: string; good: boolean }>;
  health: { score: number; prev: number; segments: HealthSegment[] }; activity: Activity[];
}

export interface Notification { id: string; agentId: AgentId; severity: Severity; title: string; body: string; href: string; at: string; read: boolean }

export interface Facet { value: string; count: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export interface ListResult { rows: Row[]; total: number; page: number; pageSize: number; facets: Record<string, Facet[]> }

export interface Citation { label: string; href: string; agentId?: AgentId; insightId?: string }
export interface ChatMessage { role: "user" | "assistant"; content: string; citations?: Citation[]; suggestions?: string[]; engine?: string; error?: boolean }

export interface ProductStats {
  id: string; sku: string; name: string; category: string; price: number; units: number; revenue: number; prevRevenue: number;
  growth: number; grossProfit: number; margin: number; returns: number; returnRate: number; rating: number; reviews: number;
  complaints: number; health: number; scores: Record<"sales" | "quality" | "reviews" | "returns" | "profit", number>; stock: number;
}

export interface StockRow {
  productId: string; sku: string; name: string; category: string; warehouse: string; onHand: number; reserved: number;
  available: number; dailySales: number; trend: number; daysLeft: number; reorderPoint: number; leadTimeDays: number;
  reorderQty: number; value: number; risk: "stockout" | "critical" | "low" | "healthy" | "overstock" | "dead"; stockoutDate?: string;
}
