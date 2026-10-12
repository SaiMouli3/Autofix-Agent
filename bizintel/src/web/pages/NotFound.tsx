import { Compass } from "lucide-react";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody } from "@/components/ui/Page";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";

export default function NotFound() {
  useCrumbs([{ label: "Not found" }]);
  return (
    <PageBody>
      <EmptyState icon={<Compass size={18} />} title="This page doesn’t exist" description="The link may be outdated, or the record was deleted." action={<ButtonLink to="/" variant="primary">Go to overview</ButtonLink>} />
    </PageBody>
  );
}
