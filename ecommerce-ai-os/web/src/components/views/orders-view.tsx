"use client";

import { useRouter } from "next/navigation";
import type { Insight, Range, View } from "@/lib/types";
import { BarChart, Donut, TrendChart } from "@/components/charts/charts";
import { Distribution, IndiaTileMap } from "@/components/charts/special";
import { AiCallout, ChartCard, KpiStrip } from "./common";

const STATUS_COLORS: Record<string, string> = {
  delivered: "var(--series-3)", in_transit: "var(--series-1)", processing: "var(--series-muted)", ndr: "var(--series-4)",
  rto: "var(--series-8)", returned: "var(--series-2)", cancelled: "var(--text-3)",
};

export function OrdersView({ view, insights, range }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const courierInsight = insights.find((i) => i.entity?.type === "courier");
  const rtoInsight = insights.find((i) => i.title.startsWith("RTO rate"));
  const statusMix = (view.statusMix as { status: string; label: string; count: number }[]).filter((s) => s.count > 0);
  const couriers = [...(view.couriers as { courier: string; onTimeRate: number }[])].sort((a, b) => a.onTimeRate - b.onTimeRate);
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={4} />
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Order trend" question="Is order volume growing, and how much of it gets delivered?" className="lg:col-span-8">
          <TrendChart data={view.trend} granularity={range.granularity} height={260}
            series={[
              { key: "orders", label: "Orders", color: "var(--series-1)", type: "area" },
              { key: "delivered", label: "Deliveries completed", color: "var(--series-3)" },
              { key: "prevOrders", label: "Orders · previous period", color: "var(--series-muted)", dashed: true, muted: true },
            ]} />
        </ChartCard>
        <ChartCard title="Order status" question="Where are this period's orders right now?" className="lg:col-span-4">
          <Donut data={statusMix} valueKey="count" labelKey="label" colors={statusMix.map((s) => STATUS_COLORS[s.status])} centerLabel="orders"
            height={168} onSelect={(d) => router.push(`/agents/orders?tab=data&status=${d.status}`)} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Delivery performance by courier" question="Which couriers deliver on time? (share delivered by the promised date)">
          <BarChart data={couriers} labelKey="courier" valueKey="onTimeRate" unit="percent" tooltipLabel="On-time"
            colorFor={(d) => (Number(d.onTimeRate) < 75 ? "var(--crit)" : "var(--series-1)")} refLine={{ y: 90, label: "Target 90%" }}
            onSelect={(d) => router.push(`/agents/orders?tab=data&courier=${d.courier}`)} />
          <AiCallout insight={courierInsight} fallback="All couriers are performing within their normal range." className="mt-4" />
        </ChartCard>
        <ChartCard title="Delivery SLA" question="How far from the promised date do orders actually arrive?">
          <Distribution data={view.sla} labelKey="bucket" valueKey="count" highlight={(d) => !!d.late} />
          <p className="mt-3 text-[12px] text-fg-3">Red bars arrive after the promised date. On-time rate: <span className="font-medium text-fg">{view.rates.onTime}%</span></p>
        </ChartCard>
      </div>
      <ChartCard title="Geographic delivery performance" question="Which states get slower deliveries? Darker tiles have lower on-time rates.">
        <IndiaTileMap data={view.states} valueKey="onTimeRate" unit="percent" label="On-time delivery" invert
          extra={(d) => (
            <div className="mt-1 space-y-0.5 text-fg-2">
              <div>Shipments: <span className="tabular text-fg">{String(d.shipments)}</span></div>
              <div>Avg transit: <span className="tabular text-fg">{String(d.avgTransitDays)} days</span></div>
              <div>RTO rate: <span className="tabular text-fg">{String(d.rtoRate)}%</span></div>
            </div>
          )}
          onSelect={(s) => router.push(`/agents/orders?tab=data&q=${encodeURIComponent(s)}`)} />
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-2" id="rto">
        <ChartCard title="RTO trend" question="Are more orders returning to origin? COD vs prepaid.">
          <TrendChart data={view.trend} granularity={range.granularity} unit="percent" height={220}
            series={[
              { key: "rtoRateCod", label: "COD RTO rate", color: "var(--series-2)", unit: "percent" },
              { key: "rtoRatePrepaid", label: "Prepaid RTO rate", color: "var(--series-1)", unit: "percent" },
            ]} />
          <AiCallout insight={rtoInsight} fallback={`RTO is stable at ${view.rates.rto}% of closed shipments.`} className="mt-4" />
        </ChartCard>
        <ChartCard title="NDR trend" question="How many deliveries fail on the first attempt?">
          <TrendChart data={view.trend} granularity={range.granularity} height={220}
            series={[{ key: "ndr", label: "Orders with NDR", color: "var(--series-4)", type: "bar" }]} />
          <p className="mt-3 text-[12px] text-fg-3">NDR rate this period: <span className="font-medium text-fg">{view.rates.ndr}%</span> of orders.</p>
        </ChartCard>
      </div>
    </div>
  );
}
