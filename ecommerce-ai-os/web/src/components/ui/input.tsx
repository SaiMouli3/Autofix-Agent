import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...props }, ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-surface px-3 text-[13.5px] text-fg placeholder:text-fg-3 shadow-xs transition-colors",
        "hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft",
        invalid && "border-crit focus:border-crit focus:ring-crit-soft",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-fg placeholder:text-fg-3 shadow-xs",
        "hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[12.5px] font-medium text-fg-2", className)} {...props} />;
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-[12px] text-crit-text">{children}</p>;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 rounded-lg border border-border bg-surface pl-2.5 pr-7 text-[12.5px] text-fg shadow-xs hover:border-border-strong focus:border-accent focus:outline-none",
        "appearance-none bg-[length:14px] bg-[right_6px_center] bg-no-repeat",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2387867f%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')]",
        className,
      )}
      {...props}
    />
  );
}
