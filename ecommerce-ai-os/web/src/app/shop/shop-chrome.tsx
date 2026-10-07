"use client";

import { ShopFooter, ShopHeader } from "@/components/shop/shop-ui";
import { useShopHome } from "@/lib/shop";

export function ShopChrome({ children }: { children: React.ReactNode }) {
  const { data } = useShopHome();
  const name = data?.store.name ?? "Loomline";
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#shop-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <ShopHeader storeName={name} categories={data?.categories.map((c) => c.name)} />
      <main id="shop-main" className="mx-auto max-w-6xl px-4">
        {children}
      </main>
      <ShopFooter storeName={name} />
    </div>
  );
}
