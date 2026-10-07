import Link from "next/link";
import { LogoMark } from "@/components/layout/logo";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div>
        <LogoMark className="mx-auto size-10" />
        <h1 className="mt-6 text-[24px] font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-[14px] text-fg-2">The link may be outdated, or the agent you&apos;re looking for has a different name.</p>
        <Link href="/dashboard" className="mt-6 inline-flex h-9 items-center rounded-lg bg-fg px-4 text-[13px] font-medium text-bg">Back to command center</Link>
      </div>
    </div>
  );
}
