import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({ title, description, action, className, eyebrow }: {
  title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; eyebrow?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-[12.5px] leading-snug text-fg-3">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5 pt-3", className)} {...props} />;
}
