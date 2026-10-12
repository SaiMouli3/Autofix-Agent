import { Link } from "react-router-dom";
import { EVIDENCE_LABELS } from "@shared/domain";
import type { EvidenceClass } from "@/lib/types";
import { useConfig } from "@/lib/queries";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { EvidenceBadge } from "@/components/business/badges";

export default function Help() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Help & documentation" }], cfg?.branding.productName);
  return (
    <PageBody>
      <PageHeader title="Help & documentation" subtitle="How discovery, research and scoring work in this workspace." />
      <div className="panel max-w-prose space-y-8 p-6 text-sm leading-relaxed">
        <section>
          <h2 className="t-section-title mb-2">1. Discover</h2>
          <p>
            On <Link className="link" to="/discover">Discover Businesses</Link>, choose a location from the suggestions, a radius and industries. Business listings come from OpenStreetMap. Coverage varies by
            region — some businesses may be missing or have outdated details.
          </p>
        </section>
        <section>
          <h2 className="t-section-title mb-2">2. Research depth</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Fast</strong> keeps the details published in the map listing.</li>
            <li><strong>Standard</strong> finds the official website when the listing has none, inspects key pages (home, contact, about, services…), extracts published contacts and writes a structured summary.</li>
            <li><strong>Deep</strong> inspects more pages and adds third-party web sources.</li>
          </ul>
          <p className="mt-2">Paid provider usage per search is capped under Settings → Research.</p>
        </section>
        <section>
          <h2 className="t-section-title mb-2">3. Evidence classifications</h2>
          <p className="mb-3">Every claim in a report carries one of these labels. Claims whose quoted excerpt cannot be found in the cited source are automatically downgraded to hypotheses.</p>
          <ul className="space-y-2">
            {(["verified_fact", "third_party", "inference", "hypothesis"] as EvidenceClass[]).map((c) => (
              <li key={c} className="flex items-start gap-3">
                <EvidenceBadge cls={c} />
                <span className="text-fg-2">
                  {c === "verified_fact" && "Stated on the company’s own website, with a matching excerpt."}
                  {c === "third_party" && "Stated by another source, with a matching excerpt."}
                  {c === "inference" && "Reasonably implied by the cited text, but not stated directly."}
                  {c === "hypothesis" && "Not supported by a source. Treat as something to verify."}
                </span>
                <span className="sr-only">{EVIDENCE_LABELS[c]}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="t-section-title mb-2">4. Contacts</h2>
          <p>
            Contacts are business details published on official websites or in map listings. “Published on official website” means where an address was found — it is not a deliverability check. The
            application never sends messages.
          </p>
        </section>
        <section id="scoring">
          <h2 className="t-section-title mb-2">5. Opportunity scoring</h2>
          <p>
            Scores combine the weighted criteria in <Link className="link" to="/settings/qualification">Settings → Qualification</Link>: industry fit, size fit, geographic fit, evidence of the needs you list,
            contactability and research confidence. Each score shows its breakdown. A high score means a good fit with your criteria, not proof the company has a specific problem. Manual status overrides are kept
            and logged.
          </p>
        </section>
        <section>
          <h2 className="t-section-title mb-2">6. Keyboard shortcuts</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><kbd className="font-mono">⌘K</kbd> / <kbd className="font-mono">Ctrl K</kbd> — search this workspace</li>
            <li>Arrow keys move through menus, suggestions and tabs; Escape closes dialogs.</li>
          </ul>
        </section>
      </div>
    </PageBody>
  );
}
