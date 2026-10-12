import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./Button";
import { Select } from "./Field";

export function Pagination({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-fg-2">
      <span className="tnum">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-2">
            <span className="hidden sm:inline">Rows</span>
            <Select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-control-sm w-[72px]" aria-label="Rows per page">
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </label>
        )}
        <span className="tnum">
          Page {page} of {pages}
        </span>
        <IconButton label="Previous page" size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton label="Next page" size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
    </div>
  );
}
