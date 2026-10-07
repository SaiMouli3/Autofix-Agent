"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, EyeOff, Info, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { Store, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { Divider, GoogleButton } from "@/components/auth/google-button";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
});
type Values = z.infer<typeof schema>;

const DEMO = { email: "admin@loomline.in", password: "demo-loomline" };

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", remember: true },
  });
  const reason = params.get("reason");

  const onSubmit = async (v: Values) => {
    setFormError(null);
    try {
      const res = await api<{ user: User; stores: Store[] }>("/auth/login", { method: "POST", body: v });
      qc.clear();
      useAppStore.getState().setStoreId(res.stores[0]?.id);
      const next = params.get("next");
      router.replace(res.stores.length === 0 ? "/onboarding" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (e) {
      setFormError(e as ApiError);
    }
  };

  return (
    <div className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Welcome back</h1>
      <p className="mt-1.5 text-[14px] text-fg-2">Sign in to your AI operations team.</p>

      {reason && (
        <div className="mt-6 flex gap-2.5 rounded-lg border border-border bg-surface-2 p-3 text-[12.5px] text-fg-2" role="status">
          <Info className="mt-0.5 size-4 shrink-0 text-fg-3" />
          Your session ended for security. Sign in again to pick up where you left off.
        </div>
      )}

      <div className="mt-7"><GoogleButton /></div>
      <Divider />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" invalid={!!errors.email} {...register("email")} />
          <FieldError>{errors.email?.message}</FieldError>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-[12px] font-medium text-fg-2 hover:text-fg hover:underline">Forgot password?</Link>
          </div>
          <div className="relative">
            <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" invalid={!!errors.password} className="pr-10" {...register("password")} />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-3 hover:text-fg" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <FieldError>{errors.password?.message}</FieldError>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg-2">
          <Checkbox checked={watch("remember")} onCheckedChange={(v) => setValue("remember", v === true)} aria-label="Remember me for 30 days" />
          Remember me for 30 days
        </label>
        {formError && (
          <div role="alert" className="rounded-lg bg-crit-soft px-3 py-2.5 text-[12.5px] text-crit-text">
            <div className="font-medium">{formError.message}</div>
            {formError.hint && <div className="mt-0.5 opacity-90">{formError.hint}</div>}
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : <>Sign in <ArrowRight /></>}
        </Button>
      </form>

      <button type="button" onClick={() => { setValue("email", DEMO.email); setValue("password", DEMO.password); }}
        className="mt-4 flex w-full items-center gap-3 rounded-lg border border-dashed border-accent-border bg-accent-soft px-3 py-2.5 text-left transition-colors hover:border-accent">
        <Sparkles className="size-4 shrink-0 text-accent" />
        <span className="text-[12.5px] text-fg-2"><span className="font-medium text-fg">Explore the demo store</span> — fill in the Loomline demo account</span>
      </button>

      <p className="mt-8 text-center text-[13px] text-fg-2">
        New to E-commerce AI OS? <Link href="/signup" className="font-medium text-fg hover:underline">Create an account</Link>
      </p>
    </div>
  );
}
