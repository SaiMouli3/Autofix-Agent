import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/format";
import { Spinner } from "./primitives";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors duration-fast select-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-focus";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary/90 shadow-xs",
  secondary: "border border-border bg-surface text-fg hover:bg-subtle shadow-xs",
  ghost: "text-fg-2 hover:bg-subtle hover:text-fg",
  subtle: "bg-subtle text-fg hover:bg-muted",
  danger: "bg-danger text-white hover:bg-danger/90",
};
const sizes: Record<Size, string> = { sm: "h-control-sm px-2.5 text-sm", md: "h-control px-3 text-sm" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size={14} /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export function ButtonLink({ variant = "secondary", size = "md", icon, className, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: Size; variant?: Variant }>(function IconButton(
  { label, size = "md", variant = "ghost", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(base, variants[variant], size === "sm" ? "h-control-sm w-7" : "h-control w-[34px]", className)}
      {...rest}
    >
      {children}
    </button>
  );
});
