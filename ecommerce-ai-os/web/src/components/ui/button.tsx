import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-medium transition-[background,color,box-shadow,border-color,transform] duration-150 select-none active:translate-y-px disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-fg text-bg hover:opacity-90 shadow-xs",
        accent: "bg-accent text-white hover:bg-accent-strong shadow-xs dark:text-[#0b0b10]",
        secondary: "bg-surface border border-border text-fg hover:bg-surface-3 hover:border-border-strong shadow-xs",
        ghost: "text-fg-2 hover:bg-surface-3 hover:text-fg",
        subtle: "bg-surface-3 text-fg hover:bg-border",
        danger: "bg-crit text-white hover:opacity-90",
        link: "text-accent-text hover:underline underline-offset-4 px-0 h-auto",
      },
      size: {
        xs: "h-7 px-2 text-xs rounded-md [&_svg]:size-3.5",
        sm: "h-8 px-2.5",
        md: "h-9 px-3.5",
        lg: "h-11 px-5 text-sm",
        icon: "size-8",
        "icon-sm": "size-7 rounded-md [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, ...props }, ref) {
  return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
