import type { DistanceUnit } from "@/lib/types";
import { Segmented } from "../ui/Tabs";
import { Input } from "../ui/Field";

const PRESETS = [1, 5, 10, 25, 50];

export function RadiusSelector({ radius, unit, onRadius, onUnit }: { radius: number; unit: DistanceUnit; onRadius: (n: number) => void; onUnit: (u: DistanceUnit) => void }) {
  const isPreset = PRESETS.includes(radius);
  const max = unit === "mi" ? 62 : 100;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Search radius"
        value={isPreset ? String(radius) : "custom"}
        onChange={(v) => onRadius(v === "custom" ? (isPreset ? 3 : radius) : Number(v))}
        options={[...PRESETS.map((p) => ({ value: String(p), label: `${p}` })), { value: "custom", label: "Custom" }]}
      />
      {!isPreset && (
        <div className="w-[88px]">
          <Input
            type="number"
            aria-label={`Custom radius in ${unit === "mi" ? "miles" : "kilometers"}`}
            min={0.1}
            max={max}
            step={0.5}
            value={radius}
            onChange={(e) => onRadius(Math.min(max, Math.max(0.1, Number(e.target.value) || 0.1)))}
            className="tnum h-[30px]"
          />
        </div>
      )}
      <Segmented
        label="Distance unit"
        size="sm"
        value={unit}
        onChange={onUnit}
        options={[
          { value: "mi", label: "mi" },
          { value: "km", label: "km" },
        ]}
      />
    </div>
  );
}
