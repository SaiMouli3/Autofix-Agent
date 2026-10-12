import { Package } from "lucide-react";
import { useEvidence, useReport } from "@/lib/queries";
import { Panel } from "../ui/Page";
import { BlockSkeleton, EmptyState } from "../ui/States";
import { Button } from "../ui/Button";
import { EvidenceList, Prose } from "./shared";
import type { TabProps } from "@/pages/Company";

export function ProductsTab({ id, poll, onResearch }: TabProps) {
  const { data: rep, isLoading } = useReport(id, poll);
  const { data: evidence = [] } = useEvidence(id, poll);
  if (isLoading) return <div className="panel"><BlockSkeleton lines={6} /></div>;
  const report = rep?.report;
  const products = report?.sections.find((s) => s.key === "products_services")?.body;
  const customers = report?.sections.find((s) => s.key === "target_customers")?.body;
  const pe = evidence.filter((e) => e.section === "products_services");
  const ce = evidence.filter((e) => e.section === "target_customers");
  if (!products && !customers && !pe.length && !ce.length)
    return (
      <div className="panel">
        <EmptyState
          icon={<Package size={18} />}
          title={report ? "No products or services identified" : "Not researched yet"}
          description={report ? "The retrieved sources did not describe the company’s offering. Deep research checks more pages and third-party sources." : "Research reads the company’s services and products pages and cites what it finds."}
          action={<Button size="sm" variant="primary" onClick={onResearch}>{report ? "Run deep research" : "Start research"}</Button>}
        />
      </div>
    );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Products and services" id="ps">
        <div className="space-y-3 p-4">
          {products ? <Prose text={products} /> : <p className="text-sm text-fg-3">No summary available.</p>}
          <EvidenceList items={pe} />
        </div>
      </Panel>
      <Panel title="Target customers" id="tc">
        <div className="space-y-3 p-4">
          {customers ? <Prose text={customers} /> : <p className="text-sm text-fg-3">Not described in the sources.</p>}
          <EvidenceList items={ce} />
        </div>
      </Panel>
    </div>
  );
}
