"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import { ErrorState } from "@/components/states/states";
import { AssistantPanel } from "./assistant";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { LogoMark } from "./logo";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: me, error, isLoading, refetch } = useMe();
  const storeId = useAppStore((s) => s.storeId);
  const setStoreId = useAppStore((s) => s.setStoreId);
  const router = useRouter();

  // Resolve the active store; send users without a store to onboarding.
  useEffect(() => {
    if (!me) return;
    if (me.stores.length === 0) {
      router.replace("/onboarding");
      return;
    }
    if (!storeId || !me.stores.some((s) => s.id === storeId)) setStoreId(me.stores[0].id);
  }, [me, storeId, setStoreId, router]);

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }
  const ready = me && me.stores.length > 0 && storeId && me.stores.some((s) => s.id === storeId);
  if (isLoading || !ready) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg" role="status" aria-label="Loading workspace">
        <div className="flex flex-col items-center gap-3">
          <LogoMark className="size-9 animate-pulse-soft" />
          <span className="text-[12.5px] text-fg-3">Waking up your AI team…</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh overflow-x-clip bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">Skip to content</a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
      </div>
      <CommandPalette />
      <AssistantPanel />
    </div>
  );
}
