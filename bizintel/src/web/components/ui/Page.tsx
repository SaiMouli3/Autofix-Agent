import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function PageHeader({ title, subtitle, actions, meta }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-5">
      <div className="min-w-0">
        <h1 className="t-page-title">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-2">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-fg-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageBody({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={cn("mx-auto w-full px-4 py-6 sm:px-6", wide ? "max-w-[1600px]" : "max-w-content", className)}>{children}</div>;
}

export function Panel({ title, actions, children, className, bodyClassName, description, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; description?: ReactNode; id?: string }) {
  return (
    <section className={cn("panel", className)} aria-labelledby={id}>
      {title && (
        <div className="panel-header">
          <div className="min-w-0">
            <h2 id={id} className="t-card-title">
              {title}
            </h2>
            {description && <p className="t-meta mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Metric({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="flex items-center gap-1.5 t-label">
        {icon && <span className="text-fg-3">{icon}</span>}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tnum tracking-tight">{value}</div>
      {hint && <div className="t-meta mt-0.5">{hint}</div>}
    </div>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[160px_1fr]">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="t-label pt-0.5">{it.label}</dt>
          <dd className="min-w-0 text-sm text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
