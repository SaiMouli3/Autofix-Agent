import { Building2, Compass } from "lucide-react";
import { useConfig } from "@/lib/queries";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { BusinessTable } from "@/components/business/BusinessTable";

export default function Businesses() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "All Businesses" }], cfg?.branding.productName);
  const unit = cfg?.research.defaultUnit === "km" ? "km" : "mi";
  return (
    <PageBody wide>
      <PageHeader title="All businesses" subtitle="Every business discovered in this workspace, across all searches." actions={<ButtonLink to="/discover" variant="primary" icon={<Compass size={15} />}>Discover businesses</ButtonLink>} />
      <BusinessTable
        unit={unit}
        exportScope={{ kind: "all" }}
        emptyState={
          <EmptyState
            icon={<Building2 size={18} />}
            title="No businesses yet"
            description="Businesses appear here after you run a discovery search."
            action={<ButtonLink to="/discover" variant="primary">Discover businesses</ButtonLink>}
          />
        }
      />
    </PageBody>
  );
}
