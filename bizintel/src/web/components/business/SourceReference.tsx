import { ExternalLink } from "lucide-react";
import { domainOf } from "@shared/domain";
import { dateTime } from "@/lib/format";
import { Tooltip } from "../ui/primitives";

/** Compact citation chip that opens the original source in a new tab. */
export function SourceReference({ url, title, retrievedAt, publishedAt, index }: { url: string | null; title?: string | null; retrievedAt?: string | null; publishedAt?: string | null; index?: number }) {
  if (!url) return <span className="t-meta">No source</span>;
  const meta = [publishedAt && `Published ${dateTime(publishedAt)}`, retrievedAt && `Retrieved ${dateTime(retrievedAt)}`].filter(Boolean).join(" · ");
  return (
    <Tooltip content={<span className="block">{title ?? url}{meta && <span className="mt-0.5 block opacity-75">{meta}</span>}</span>}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-5 max-w-[220px] items-center gap-1 rounded border border-border bg-subtle px-1.5 text-2xs font-medium text-fg-2 hover:border-border-strong hover:text-fg"
      >
        {index != null && <span className="tnum text-fg-3">{index}</span>}
        <span className="truncate">{domainOf(url) ?? url}</span>
        <ExternalLink size={10} className="shrink-0" aria-hidden />
        <span className="sr-only">(opens in new tab)</span>
      </a>
    </Tooltip>
  );
}
