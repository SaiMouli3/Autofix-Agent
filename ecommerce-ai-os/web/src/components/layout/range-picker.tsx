"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAppStore, type RangeKey } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";

const PRESETS: { key: RangeKey; label: string; short: string }[] = [
  { key: "today", label: "Today", short: "Today" },
  { key: "yesterday", label: "Yesterday", short: "Yesterday" },
  { key: "7d", label: "Last 7 days", short: "7D" },
  { key: "30d", label: "Last 30 days", short: "30D" },
  { key: "90d", label: "Last 90 days", short: "90D" },
];

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function RangePicker({ className }: { className?: string }) {
  const { range, from, to, setRange } = useAppStore();
  const [open, setOpen] = useState(false);
  const today = new Date();
  const minDate = new Date(today.getTime() - 175 * 86400e3);
  const [cf, setCf] = useState(from ?? iso(new Date(today.getTime() - 13 * 86400e3)));
  const [ct, setCt] = useState(to ?? iso(today));
  const label = range === "custom" && from && to
    ? `${new Date(from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(to).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
    : PRESETS.find((p) => p.key === range)?.label ?? "Last 30 days";
  const invalid = !cf || !ct || cf > ct;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="hidden items-center rounded-lg border border-border bg-surface-2 p-0.5 xl:flex" role="radiogroup" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p.key} role="radio" aria-checked={range === p.key} onClick={() => setRange(p.key)}
            className={cn("h-7 rounded-md px-2.5 text-[12.5px] font-medium text-fg-3 transition-colors hover:text-fg", range === p.key && "bg-surface text-fg shadow-xs")}>
            {p.short}
          </button>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant={range === "custom" ? "secondary" : "ghost"} className="max-xl:border max-xl:border-border max-xl:bg-surface" aria-label="Choose date range">
            <CalendarDays />
            <span className="max-w-[140px] truncate xl:hidden">{label}</span>
            <span className="hidden xl:inline">{range === "custom" ? label : "Custom"}</span>
            <ChevronDown className="!size-3.5 text-fg-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-1.5">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => { setRange(p.key); setOpen(false); }}
              className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[13px] text-fg-2 hover:bg-surface-3 hover:text-fg">
              {p.label}
              {range === p.key && <Check className="size-4 text-fg" strokeWidth={2.5} />}
            </button>
          ))}
          <div className="mt-1.5 border-t border-border p-2">
            <div className="mb-2 text-[12px] font-medium text-fg-2">Custom range</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="rf" className="text-[11px]">From</Label>
                <Input id="rf" type="date" className="h-8 px-2 text-[12px]" value={cf} min={iso(minDate)} max={iso(today)} onChange={(e) => setCf(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rt" className="text-[11px]">To</Label>
                <Input id="rt" type="date" className="h-8 px-2 text-[12px]" value={ct} min={iso(minDate)} max={iso(today)} onChange={(e) => setCt(e.target.value)} />
              </div>
            </div>
            {invalid && <p className="mt-1.5 text-[11.5px] text-crit-text">Start date must be before the end date.</p>}
            <Button size="sm" variant="primary" className="mt-2.5 w-full" disabled={invalid} onClick={() => { setRange("custom", cf, ct); setOpen(false); }}>
              Apply range
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
