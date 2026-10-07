"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const schema = z.object({ email: z.string().trim().email("Enter a valid email address") });

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({ resolver: zodResolver(schema) });
  if (sent) {
    return (
      <div className="animate-rise">
        <div className="mb-5 grid size-11 place-items-center rounded-xl bg-good-soft text-good-text"><MailCheck className="size-5" /></div>
        <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Check your inbox</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-2">
          If an account exists for <span className="font-medium text-fg">{sent}</span>, a reset link is on its way. It expires in 30 minutes.
        </p>
        <Link href="/login" className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium hover:underline"><ArrowLeft className="size-4" /> Back to sign in</Link>
      </div>
    );
  }
  return (
    <div className="animate-rise">
      <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Reset your password</h1>
      <p className="mt-1.5 text-[14px] text-fg-2">Enter the email you use for E-commerce AI OS and we&apos;ll send you a reset link.</p>
      <form
        className="mt-7 space-y-4"
        noValidate
        onSubmit={handleSubmit(async ({ email }) => {
          setErr(null);
          try {
            await api("/auth/forgot", { method: "POST", body: { email } });
            setSent(email);
          } catch (e) {
            setErr(e as ApiError);
          }
        })}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register("email")} />
          <FieldError>{errors.email?.message ?? err?.message}</FieldError>
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Sending…" : "Send reset link"}</Button>
      </form>
      <Link href="/login" className="mt-8 inline-flex items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg"><ArrowLeft className="size-4" /> Back to sign in</Link>
    </div>
  );
}
