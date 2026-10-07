"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Divider, GoogleButton } from "@/components/auth/google-button";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  company: z.string().trim().max(80).optional(),
  email: z.string().trim().email("Enter a valid work email"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});
type Values = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<ApiError | null>(null);
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });
  const pw = watch("password") ?? "";
  const checks = [
    { ok: pw.length >= 8, label: "8+ characters" },
    { ok: /[0-9]/.test(pw), label: "A number" },
    { ok: /[A-Za-z]/.test(pw) && /[^A-Za-z0-9]/.test(pw) || /[A-Z]/.test(pw), label: "Mixed case or symbol" },
  ];

  const onSubmit = async (v: Values) => {
    setFormError(null);
    try {
      await api("/auth/signup", { method: "POST", body: v });
      qc.clear();
      useAppStore.getState().setStoreId(undefined);
      router.replace("/onboarding");
    } catch (e) {
      setFormError(e as ApiError);
    }
  };

  return (
    <div className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Hire your AI operations team</h1>
      <p className="mt-1.5 text-[14px] text-fg-2">Set up in under two minutes. No credit card required.</p>
      <div className="mt-7"><GoogleButton label="Sign up with Google" /></div>
      <Divider />
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" autoComplete="name" invalid={!!errors.name} {...register("name")} />
            <FieldError>{errors.name?.message}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company">Company</Label>
            <Input id="company" autoComplete="organization" placeholder="Optional" {...register("company")} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" invalid={!!errors.email} {...register("email")} />
          <FieldError>{errors.email?.message}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register("password")} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {checks.map((c) => (
              <span key={c.label} className={cn("inline-flex items-center gap-1 text-[11.5px] transition-colors", c.ok ? "text-good-text" : "text-fg-3")}>
                <Check className="size-3" strokeWidth={3} /> {c.label}
              </span>
            ))}
          </div>
          <FieldError>{errors.password?.message}</FieldError>
        </div>
        {formError && (
          <div role="alert" className="rounded-lg bg-crit-soft px-3 py-2.5 text-[12.5px] text-crit-text">
            <div className="font-medium">{formError.message}</div>
            {formError.hint && <div className="mt-0.5 opacity-90">{formError.hint}</div>}
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating your workspace…" : <>Create account <ArrowRight /></>}
        </Button>
        <p className="text-center text-[11.5px] text-fg-3">By continuing you agree to the Terms and acknowledge the Privacy Policy.</p>
      </form>
      <p className="mt-8 text-center text-[13px] text-fg-2">
        Already have an account? <Link href="/login" className="font-medium text-fg hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
