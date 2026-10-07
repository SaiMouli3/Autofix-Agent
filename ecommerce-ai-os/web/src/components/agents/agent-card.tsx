"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { agentHref } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { formatValue } from "@/lib/format";
import type { AgentSummary } from "@/lib/types";
import { Meter } from "@/components/ui/misc";
import { AgentIcon, AgentStatusBadge, LastAnalysis } from "./primitives";

export function AgentCard({ agent, index = 0 }: { agent: AgentSummary; index?: number }) {
  const delta = agent.health - agent.healthPrev;
  return (
    <Link
      href={agentHref(agent.id)}
      className={cn(
        "group card flex flex-col gap-4 p-4 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card animate-rise",
        agent.status === "paused" && "opacity-70",
      )}
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentIcon id={agent.id} />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">{agent.shortName}</div>
            <AgentStatusBadge status={agent.status} className="text-[11.5px]" />
          </div>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 -translate-x-1 text-fg-3 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
          <span className="text-fg-3">Health</span>
          <span className="tabular">
            <span className="text-[15px] font-semibold text-fg">{Math.round(agent.health)}</span>
            <span className={cn("ml-1.5 text-[11.5px]", delta >= 0 ? "text-good-text" : "text-crit-text")}>
              {delta >= 0 ? "+" : ""}
              {Math.round(delta)}
            </span>
          </span>
        </div>
        <Meter value={agent.health} label={`${agent.shortName} health`} />
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-[11.5px]">
        <div>
          <div className={cn("text-[15px] font-semibold tabular", agent.issues > 0 ? "text-crit-text" : "text-fg")}>{agent.issues}</div>
          <div className="text-fg-3">Issues</div>
        </div>
        <div>
          <div className={cn("text-[15px] font-semibold tabular", agent.opportunities > 0 ? "text-good-text" : "text-fg")}>{agent.opportunities}</div>
          <div className="text-fg-3">Opportunities</div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold tabular">{formatValue(agent.headline.value, agent.headline.unit)}</div>
          <div className="truncate text-fg-3" title={agent.headline.label}>{agent.headline.label}</div>
        </div>
      </div>
      <div className="-mt-1 flex items-center justify-between text-[11px] text-fg-3">
        <span>Last analysis <LastAnalysis at={agent.lastAnalysis} /></span>
        <span className="truncate">{agent.dataSources.slice(0, 2).join(" · ")}</span>
      </div>
    </Link>
  );
}
