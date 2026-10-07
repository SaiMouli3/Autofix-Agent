"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CreditCard, Lock, Package } from "lucide-react";
import { ApiError } from "@/lib/api";
import { FieldError, Input, Label } from "@/components/ui/input";
import { OrderSummary } from "@/components/shop/shop-ui";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import { cartTotals, lastOrder, useCart, usePlaceOrder, useShopHome } from "@/lib/shop";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80, "Use 80 characters or fewer"),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z.string().trim().max(20, "Enter a shorter phone number"),
  city: z.string().trim().min(2, "Enter your city").max(60, "Use 60 characters or fewer"),
  state: z.string().min(1, "Choose your state"),
  payment: z.enum(["card", "cod"]),
});
type Form = z.infer<typeof schema>;

export default function CheckoutPage() {
  const router = useRouter();
  const { lines, clear } = useCart();
  const home = useShopHome();
  const place = usePlaceOrder();
  const [hydrated, setHydrated] = useState(false);
  const [serverError, setServerError] = useState<string>();
  useEffect(() => setHydrated(true), []);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", phone: "", city: "", state: "", payment: "card" },
  });
  const payment = watch("payment");
  const free = home.data?.freeShipping ?? 35;
  const t = cartTotals(lines, free, home.data?.shippingFee);

  useEffect(() => {
    if (hydrated && lines.length === 0 && !place.isSuccess) router.replace("/shop/cart");
  }, [hydrated, lines.length, place.isSuccess, router]);

  if (!hydrated || lines.length === 0) return <div className="min-h-[50vh]" />;

  const onSubmit = handleSubmit(async (f) => {
    setServerError(undefined);
    try {
      const order = await place.mutateAsync({
        items: lines.map((l) => ({ productId: l.id, qty: l.qty })),
        customer: { name: f.name, email: f.email, phone: f.phone, city: f.city, state: f.state },
        payment: f.payment,
      });
      lastOrder.save(order);
      clear();
      router.push("/shop/order");
    } catch (e) {
      setServerError(e instanceof ApiError ? [e.message, e.hint].filter(Boolean).join(" ") : "We couldn't place your order. Try again.");
    }
  });

  return (
    <div className="flex flex-col gap-8 pt-10">
      <div>
        <Link href="/shop/cart" className="text-[13px] text-fg-3 hover:text-fg">← Back to bag</Link>
        <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.04em]">Checkout</h1>
      </div>
      <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-[16px] font-semibold">Contact</legend>
            <Field label="Full name" error={errors.name?.message}>
              <Input autoComplete="name" invalid={!!errors.name} {...register("name")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" error={errors.email?.message}>
                <Input type="email" autoComplete="email" invalid={!!errors.email} {...register("email")} />
              </Field>
              <Field label="Phone (optional)" error={errors.phone?.message}>
                <Input type="tel" autoComplete="tel" invalid={!!errors.phone} {...register("phone")} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-[16px] font-semibold">Delivery</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City" error={errors.city?.message}>
                <Input autoComplete="address-level2" invalid={!!errors.city} {...register("city")} />
              </Field>
              <Field label="State" error={errors.state?.message}>
                <select
                  {...register("state")}
                  aria-invalid={!!errors.state}
                  className={cn("h-9 w-full rounded-lg border bg-surface px-2.5 text-[13px] text-fg", errors.state ? "border-crit" : "border-border")}
                >
                  <option value="">Choose a state</option>
                  {(home.data?.states ?? []).map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[16px] font-semibold">Payment</legend>
            {[
              { value: "card", icon: CreditCard, title: "Card", text: "Paid now. Demo store: no card details are collected and no charge is made." },
              { value: "cod", icon: Package, title: "Pay on delivery", text: "Pay the courier when your order arrives." },
            ].map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                  payment === o.value ? "border-fg bg-surface" : "border-border bg-surface hover:border-border-strong",
                )}
              >
                <input type="radio" value={o.value} {...register("payment")} className="mt-1 accent-[var(--text)]" />
                <o.icon className="mt-0.5 size-5 text-fg-2" aria-hidden />
                <span className="flex flex-col">
                  <span className="text-[14px] font-medium">{o.title}</span>
                  <span className="text-[13px] text-fg-3">{o.text}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {serverError && (
            <p role="alert" className="rounded-lg border border-crit/30 bg-crit-soft px-4 py-3 text-[13px] text-crit-text">
              {serverError}
            </p>
          )}

          <button type="submit" disabled={place.isPending} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-fg text-[15px] font-medium text-bg hover:opacity-90 disabled:opacity-60 lg:hidden">
            <Lock className="size-4" /> {place.isPending ? "Placing order…" : `Place order · ${usd(t.total, { compact: false })}`}
          </button>
        </form>

        <OrderSummary subtotal={t.subtotal} shipping={t.shipping} total={t.total} free={free}>
          <ul className="flex flex-col gap-2 border-t border-border pt-3 text-[13px]">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="truncate text-fg-2">{l.qty} × {l.name}</span>
                <span className="shrink-0 tabular">{usd(l.price * l.qty, { compact: false })}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onSubmit}
            disabled={place.isPending}
            className="mt-2 hidden h-11 w-full items-center justify-center gap-2 rounded-lg bg-fg text-[14px] font-medium text-bg hover:opacity-90 disabled:opacity-60 lg:inline-flex"
          >
            <Lock className="size-4" /> {place.isPending ? "Placing order…" : "Place order"}
          </button>
        </OrderSummary>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        <span className="mb-1.5 block">{label}</span>
        {children}
      </Label>
      <FieldError>{error}</FieldError>
    </div>
  );
}
