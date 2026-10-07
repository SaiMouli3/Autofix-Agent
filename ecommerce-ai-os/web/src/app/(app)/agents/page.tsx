"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { useAgents } from "@/lib/queries";
import { AgentCard } from "@/components/agents/agent-card";
import { ActivityFeed } from "@/components/agents/insights";
import { PageHeader } from "@/components/layout/topbar";
import { Card, CardHeader } from "@/components/ui/card";
import { CardSkeleton, ErrorState } from "@/components/states/states";

const PIPELINE = ["Data", "Monitoring", "Detection", "Explanation", "Recommendation", "Action"];

export default function AgentsPage() {
  const { data, error, refetch } = useAgents();
  if (error && !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const totalIssues = data?.agents.reduce((s, a) => s + a.issues, 0) ?? 0;
  const attention = data?.agents.filter((a) => a.status === "attention").length ?? 0;
  return (
    <div>
      <PageHeader title="Your AI Team" description="Ten specialised agents, each owning one business domain and monitoring it continuously — plus a Business Insights agent that connects their findings." />
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-[12.5px]">
        {PIPELINE.map((p, i) => (
          <span key={p} className="flex items-center gap-2">
            <span className="rounded-md bg-surface-3 px-2 py-1 font-medium text-fg-2">{p}</span>
            {i < PIPELINE.length - 1 && <ArrowRight className="size-3.5 text-fg-3" />}
          </span>
        ))}
        <span className="ml-auto text-fg-3">{data ? `${attention} agents need attention · ${totalIssues} open issues` : " "}</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
            {data ? data.agents.map((a, i) => <AgentCard key={a.id} agent={a} index={i} />) : Array.from({ length: 9 }).map((_, i) => <CardSkeleton key={i} lines={4} />)}
          </div>
          {data && (
            <Link href="/insights" className="mt-3 flex items-center gap-4 rounded-xl border border-accent-border bg-accent-soft p-4 transition-colors hover:border-accent">
              <span className="grid size-10 place-items-center rounded-xl bg-accent text-white dark:text-[#0b0b10]"><Sparkles className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">Business Insights Agent</div>
                <div className="text-[12.5px] text-fg-2">CEO-level layer · connects, reasons, prioritises and recommends · {data.business.issues} issues, {data.business.opportunities} opportunities</div>
              </div>
              <ArrowRight className="size-4 text-accent-text" />
            </Link>
          )}
        </div>
        <Card className="h-fit xl:col-span-4">
          <CardHeader title="Team activity" description="Every scan, detection and action across agents" />
          <div className="scrollbar-thin mt-2 max-h-[760px] overflow-y-auto pb-3">
            {data ? <ActivityFeed items={data.activity} /> : <div className="p-5"><CardSkeleton /></div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
