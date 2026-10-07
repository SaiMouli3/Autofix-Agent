"use client";

import { useEffect, useState } from "react";
import { AGENTS } from "@/lib/agents";

const FEED = [
  { agent: "Order & Delivery", text: "Courier delays detected in the East region", tone: "var(--crit)" },
  { agent: "Product Intelligence", text: "Return rate spike isolated to one SKU", tone: "var(--crit)" },
  { agent: "Customer", text: "740 customers due to repurchase this month", tone: "var(--good)" },
  { agent: "Pricing & Competitor", text: "Competitor reset price by 12% on a key product", tone: "var(--info)" },
  { agent: "Inventory", text: "Best-seller projected to stock out in 4 days", tone: "var(--crit)" },
  { agent: "Business Insights", text: "Connected 3 signals into one quality issue", tone: "var(--accent)" },
];

/** Live agent-network visual for the auth screens: ten agents orbiting a core. */
export function AuthVisual() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 2600);
    return () => clearInterval(t);
  }, []);
  const size = 420;
  const c = size / 2;
  const nodes = AGENTS.map((a, i) => {
    const ring = i % 2 === 0 ? 150 : 108;
    const ang = (i / AGENTS.length) * Math.PI * 2 - Math.PI / 2;
    return { ...a, x: c + ring * Math.cos(ang), y: c + ring * Math.sin(ang) };
  });
  const active = tick % nodes.length;
  const feed = [0, 1, 2].map((k) => FEED[(tick + k) % FEED.length]);
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden p-10">
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_40%,var(--accent-soft),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div className="relative">
        <div className="eyebrow">Live agent network</div>
        <p className="mt-2 max-w-sm text-[22px] font-semibold leading-snug tracking-[-0.02em]">
          Ten specialists watch every part of your store. One connects the dots.
        </p>
      </div>
      <div className="relative mx-auto my-6 w-full max-w-[420px]">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full" aria-hidden>
          <circle cx={c} cy={c} r={150} fill="none" stroke="var(--border-strong)" strokeDasharray="2 6" />
          <circle cx={c} cy={c} r={108} fill="none" stroke="var(--border)" />
          {nodes.map((n, i) => (
            <line key={n.id} x1={c} y1={c} x2={n.x} y2={n.y} stroke={i === active ? "var(--accent)" : "var(--border)"} strokeWidth={i === active ? 1.5 : 1}
              strokeDasharray={i === active ? "4 4" : undefined} className="transition-all duration-700" />
          ))}
          {nodes.map((n, i) => (
            <g key={n.id} className="transition-transform duration-700" style={{ transformOrigin: `${n.x}px ${n.y}px`, transform: i === active ? "scale(1.15)" : "scale(1)" }}>
              <circle cx={n.x} cy={n.y} r={17} fill="var(--surface)" stroke={i === active ? n.hue : "var(--border-strong)"} strokeWidth={i === active ? 2 : 1} />
              <foreignObject x={n.x - 8} y={n.y - 8} width={16} height={16}>
                <n.icon style={{ width: 16, height: 16, color: n.hue }} />
              </foreignObject>
            </g>
          ))}
          <circle cx={c} cy={c} r={30} fill="var(--text)" />
          <circle cx={c} cy={c} r={42} fill="none" stroke="var(--accent)" strokeOpacity={0.35}>
            <animate attributeName="r" values="34;54;34" dur="3.2s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.45;0;0.45" dur="3.2s" repeatCount="indefinite" />
          </circle>
          <circle cx={c} cy={c} r={6} fill="var(--accent)" />
        </svg>
      </div>
      <ul className="relative space-y-2" aria-hidden>
        {feed.map((f, i) => (
          <li key={`${tick}-${i}`} className="flex items-center gap-3 rounded-lg border border-border bg-surface/80 px-3 py-2 text-[12.5px] backdrop-blur animate-rise" style={{ animationDelay: `${i * 90}ms`, opacity: 1 - i * 0.25 }}>
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: f.tone }} />
            <span className="shrink-0 font-medium text-fg">{f.agent}</span>
            <span className="truncate text-fg-3">{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
