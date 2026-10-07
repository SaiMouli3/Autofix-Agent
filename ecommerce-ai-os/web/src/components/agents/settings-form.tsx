"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pause, Play } from "lucide-react";
import { SEVERITY } from "@/lib/agents";
import { useAgentSettings } from "@/lib/queries";
import type { AgentSettings, AgentSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented, Switch } from "@/components/ui/misc";

export function AgentSettingsForm({ agent, settings }: { agent: AgentSummary; settings: AgentSettings }) {
  const [s, setS] = useState<AgentSettings>(settings);
  const save = useAgentSettings(agent.id);
  useEffect(() => setS(settings), [settings]);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const submit = (next: AgentSettings, msg: string) =>
    save.mutate(next, { onSuccess: () => toast.success(msg), onError: (e) => toast.error((e as Error).message) });

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-8">
        <Card>
          <CardHeader title="Monitoring" description="Pause the agent to stop new detections and notifications. Historical findings stay available." />
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px]">
              <div className="font-medium">{s.paused ? "Agent is paused" : "Agent is monitoring continuously"}</div>
              <div className="text-fg-3">Last analysis ran over {agent.recordsAnalyzed.toLocaleString("en-IN")} records.</div>
            </div>
            <Button variant={s.paused ? "primary" : "secondary"} disabled={save.isPending}
              onClick={() => { const n = { ...s, paused: !s.paused }; setS(n); submit(n, n.paused ? `${agent.shortName} agent paused` : `${agent.shortName} agent resumed`); }}>
              {s.paused ? <><Play /> Resume monitoring</> : <><Pause /> Pause agent</>}
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Detection sensitivity" description="How large a change must be before the agent raises it." />
          <CardBody>
            <Segmented value={s.sensitivity} onChange={(v) => setS({ ...s, sensitivity: v })} ariaLabel="Sensitivity"
              options={[{ value: "low", label: "Low · fewer alerts" }, { value: "balanced", label: "Balanced" }, { value: "high", label: "High · catch early" }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Notifications" description="Choose which findings notify you, and how often." />
          <CardBody className="space-y-3">
            {(["critical", "important", "opportunity", "market"] as const).map((k) => (
              <label key={k} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex items-center gap-2"><span className={`size-2 rounded-full ${SEVERITY[k].dot}`} /> {SEVERITY[k].label} findings</span>
                <Switch checked={!!s.notify?.[k]} onCheckedChange={(v) => setS({ ...s, notify: { ...s.notify, [k]: v } })} aria-label={`Notify on ${k} findings`} />
              </label>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-[13px]">
              <span>Delivery</span>
              <Segmented value={s.digest} onChange={(v) => setS({ ...s, digest: v })} ariaLabel="Digest" size="xs"
                options={[{ value: "realtime", label: "Real-time" }, { value: "daily", label: "Daily digest" }, { value: "weekly", label: "Weekly" }]} />
            </div>
          </CardBody>
        </Card>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setS(settings)}>Reset</Button>
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => submit(s, "Monitoring settings saved")}>Save changes</Button>
        </div>
      </div>
      <Card className="h-fit lg:col-span-4">
        <CardHeader title="Data sources" description="Systems this agent reads from" />
        <CardBody className="space-y-2">
          {agent.dataSources.map((d) => (
            <div key={d} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12.5px]">
              <span>{d}</span>
              <span className="inline-flex items-center gap-1.5 text-good-text"><span className="size-1.5 rounded-full bg-good" /> Connected</span>
            </div>
          ))}
          <div className="pt-2 text-[12px] text-fg-3">Responsibilities: {agent.responsibilities.join(", ")}.</div>
        </CardBody>
      </Card>
    </div>
  );
}
