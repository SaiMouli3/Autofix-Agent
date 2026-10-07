"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, description, hideClose }: {
  className?: string; children: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] animate-fade-in dark:bg-black/60" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-[12vh] z-[61] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 rounded-xl border border-border bg-surface shadow-pop animate-rise",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-fg-3">{description}</DialogPrimitive.Description>}
          </div>
          {!hideClose && (
            <DialogPrimitive.Close className="rounded-md p-1 text-fg-3 hover:bg-surface-3 hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Right-side drawer for drill-downs. */
export function Sheet({ open, onOpenChange, title, description, children, width = "max-w-xl", headerExtra }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; width?: string; headerExtra?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/25 animate-fade-in dark:bg-black/55" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-[61] flex w-full flex-col border-l border-border bg-surface shadow-pop outline-none",
            "data-[state=open]:animate-[rise_260ms_cubic-bezier(.2,.7,.2,1)]",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[15px] font-semibold leading-snug">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-fg-3">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">Details</DialogPrimitive.Description>
              )}
            </div>
            <div className="flex items-center gap-1">
              {headerExtra}
              <DialogPrimitive.Close className="rounded-md p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({ className, align = "end", children, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={8}
        className={cn("z-[70] rounded-xl border border-border bg-surface shadow-pop outline-none animate-rise", className)}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className, align = "end", ...props }: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn("z-[70] min-w-48 rounded-xl border border-border bg-surface p-1 shadow-pop animate-rise", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg [&_svg]:size-4 [&_svg]:text-fg-3",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem
      className={cn("flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 outline-none data-[highlighted]:bg-surface-3", className)}
      {...props}
    >
      <span className="grid size-4 place-items-center rounded border border-border-strong data-[state=checked]:bg-accent">
        <DropdownPrimitive.ItemIndicator>
          <svg viewBox="0 0 12 12" className="size-3 text-accent" fill="none" stroke="currentColor" strokeWidth="2"><path d="m2.5 6 2.5 2.5 4.5-5" /></svg>
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-3", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}
