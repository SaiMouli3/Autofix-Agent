import { RESEARCH_STATUS_LABELS } from "@shared/domain";
import type { BusinessQuery, ResearchStatus } from "@/lib/types";
import { useMeta } from "@/lib/queries";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Dialog";
import { Checkbox, Field, Input, Select } from "../ui/Field";
import { IndustryMultiSelect } from "../search/IndustryMultiSelect";
import { QUALIFICATION_OPTIONS } from "./badges";

type Update = (patch: Record<string, string | number | boolean | string[] | undefined | null>) => void;

function TriSelect({ label, value, onChange, id }: { label: string; value: boolean | undefined; onChange: (v: string | null) => void; id: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Any</option>
        <option value="true">Available</option>
        <option value="false">Not available</option>
      </Select>
    </Field>
  );
}

export function BusinessFilters({ open, onClose, query, update, onClear, activeCount }: { open: boolean; onClose: () => void; query: BusinessQuery; update: Update; onClear: () => void; activeCount: number }) {
  const { data: meta } = useMeta();
  const statuses = Object.keys(RESEARCH_STATUS_LABELS) as ResearchStatus[];
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Filters${activeCount ? ` (${activeCount})` : ""}`}
      footer={
        <>
          <Button onClick={onClear} disabled={!activeCount}>
            Clear all
          </Button>
          <Button variant="primary" onClick={onClose}>
            Show results
          </Button>
        </>
      }
    >
      <div className="space-y-5 p-4">
        <Field label="Industry" htmlFor="flt-industry">
          {meta && <IndustryMultiSelect id="flt-industry" groups={meta.industries} value={query.industries ?? []} onChange={(v) => update({ industries: v })} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country code" htmlFor="flt-country" hint="ISO code, e.g. US">
            <Input id="flt-country" maxLength={2} value={query.countryCode ?? ""} onChange={(e) => update({ country: e.target.value.toUpperCase() || null })} placeholder="Any" />
          </Field>
          <Field label="State / region" htmlFor="flt-region">
            <Input id="flt-region" value={query.region ?? ""} onChange={(e) => update({ region: e.target.value || null })} placeholder="Any" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TriSelect id="flt-email" label="Public email" value={query.hasEmail} onChange={(v) => update({ email: v })} />
          <TriSelect id="flt-phone" label="Public phone" value={query.hasPhone} onChange={(v) => update({ phone: v })} />
          <TriSelect id="flt-web" label="Official website" value={query.hasWebsite} onChange={(v) => update({ website: v })} />
        </div>
        <fieldset>
          <legend className="t-label mb-2">Research status</legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {statuses.map((s) => (
              <Checkbox
                key={s}
                label={RESEARCH_STATUS_LABELS[s]}
                checked={query.researchStatus?.includes(s) ?? false}
                onChange={(e) => update({ status: e.target.checked ? [...(query.researchStatus ?? []), s] : (query.researchStatus ?? []).filter((x) => x !== s) })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="t-label mb-2">Qualification</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {QUALIFICATION_OPTIONS.map((o) => (
              <Checkbox
                key={o.value}
                label={o.label}
                checked={query.qualification?.includes(o.value) ?? false}
                onChange={(e) => update({ qual: e.target.checked ? [...(query.qualification ?? []), o.value] : (query.qualification ?? []).filter((x) => x !== o.value) })}
              />
            ))}
          </div>
        </fieldset>
        <Field label="Minimum opportunity score" htmlFor="flt-score" hint="Only businesses that have been scored.">
          <Input id="flt-score" type="number" min={0} max={100} value={query.minScore ?? ""} onChange={(e) => update({ minScore: e.target.value || null })} placeholder="Any" className="tnum" />
        </Field>
      </div>
    </Drawer>
  );
}
