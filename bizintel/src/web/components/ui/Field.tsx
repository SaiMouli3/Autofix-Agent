import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/format";

const control =
  "w-full rounded border border-border bg-surface px-2.5 text-sm text-fg placeholder:text-fg-3 shadow-xs transition-colors duration-fast hover:border-border-strong focus:border-primary focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function Input({ className, icon, ...rest }, ref) {
  if (!icon) return <input ref={ref} className={cn(control, "h-control", className)} {...rest} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3">{icon}</span>
      <input ref={ref} className={cn(control, "h-control pl-8", className)} {...rest} />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-[88px] py-2 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, "h-control appearance-none pr-8", className)} {...rest}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
    </div>
  );
});

export function Checkbox({ label, className, indeterminate, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; indeterminate?: boolean }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-fg", rest.disabled && "cursor-not-allowed opacity-60", className)}>
      <input
        type="checkbox"
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate);
        }}
        className="h-4 w-4 cursor-pointer rounded-sm border-border-strong accent-[rgb(var(--c-primary))]"
        {...rest}
      />
      {label}
    </label>
  );
}

export function Field({ label, hint, error, children, htmlFor, optional }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5 t-label">
        {label}
        {optional && <span className="font-normal text-fg-3">Optional</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="t-meta">{hint}</p>
      ) : null}
    </div>
  );
}

export function useFieldId(prefix = "f") {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}
