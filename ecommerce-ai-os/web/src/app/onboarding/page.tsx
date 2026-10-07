"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Check, FileSpreadsheet, Home, Laptop, Leaf, Package, Shirt, ShoppingBag, ShoppingCart, Sparkles, Store as StoreIcon, Wand2,
} from "lucide-react";
import { AGENTS, BUSINESS_AGENT } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { useCreateStore, useMe } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Logo } from "@/components/layout/logo";

type Step = "welcome" | "business" | "connect" | "init" | "ready";
const ORDER: Step[] = ["welcome", "business", "connect", "init", "ready"];

const BUSINESS = [
  { id: "fashion", label: "Fashion & apparel", icon: Shirt, hint: "Clothing, footwear, accessories" },
  { id: "electronics", label: "Electronics", icon: Laptop, hint: "Audio, wearables, gadgets" },
  { id: "beauty", label: "Beauty & personal care", icon: Sparkles, hint: "Skincare, haircare, makeup" },
  { id: "grocery", label: "Grocery & gourmet", icon: Leaf, hint: "Staples, snacks, beverages" },
  { id: "home", label: "Home & living", icon: Home, hint: "Bedding, kitchen, decor" },
  { id: "d2c", label: "D2C brand", icon: ShoppingBag, hint: "Multi-category direct-to-consumer" },
  { id: "other", label: "Something else", icon: Package, hint: "We'll adapt to your catalog" },
];

const PLATFORMS = [
  { id: "demo", label: "Demo Store", desc: "Explore instantly with a realistic store: 17k orders, 10k customers, 100 products.", icon: Wand2, available: true },
  { id: "shopify", label: "Shopify", desc: "Orders, products, customers and inventory via the Admin API.", icon: ShoppingCart, available: false },
  { id: "woocommerce", label: "WooCommerce", desc: "REST API connection with read-only keys.", icon: StoreIcon, available: false },
  { id: "amazon", label: "Amazon Seller", desc: "SP-API for orders, returns and reviews.", icon: Package, available: false },
  { id: "flipkart", label: "Flipkart", desc: "Seller API for orders, returns and listings.", icon: ShoppingBag, available: false },
  { id: "csv", label: "CSV upload", desc: "Upload orders, products and customers exports.", icon: FileSpreadsheet, available: false },
];

const INIT_STEPS = [
  "Connecting Order Agent",
  "Connecting Customer Agent",
  "Analyzing Reviews",
  "Triaging Support Conversations",
  "Analyzing Products",
  "Analyzing Inventory",
  "Scanning Competitor Prices",
  "Analyzing Marketing",
  "Analyzing Finance",
  "Scanning Market News",
  "Connecting insights across agents",
];

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const create = useCreateStore();
  const [step, setStep] = useState<Step>(params.get("step") === "business" ? "business" : "welcome");
  const [business, setBusiness] = useState<string>("fashion");
  const [platform, setPlatform] = useState("demo");
  const [storeName, setStoreName] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const firstName = me?.user.name.split(" ")[0] ?? "";

  // Agent initialisation: animate while the store is generated and analysed.
  useEffect(() => {
    if (step !== "init") return;
    setProgress(0);
    setError(null);
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setProgress((p) => Math.min(p + 1, INIT_STEPS.length - 1));
      if (i > 40) clearInterval(timer);
    }, 360);
    create.mutate(
      { platform, businessType: business, name: storeName.trim() || undefined },
      {
        onSuccess: (r) => {
          useAppStore.getState().setStoreId(r.store.id);
          qc.invalidateQueries();
        },
        onError: (e) => {
          clearInterval(timer);
          setError(e as ApiError);
        },
      },
    );
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === "init" && create.isSuccess && progress >= INIT_STEPS.length - 1) {
      const t = setTimeout(() => { setProgress(INIT_STEPS.length); setTimeout(() => setStep("ready"), 650); }, 400);
      return () => clearTimeout(t);
    }
  }, [step, create.isSuccess, progress]);

  const idx = ORDER.indexOf(step);
  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg">
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(50%_40%_at_50%_0%,var(--accent-soft),transparent_70%)]" />
      <header className="relative flex items-center justify-between px-6 py-5 sm:px-10">
        <Logo />
        <div className="flex items-center gap-1.5" aria-label={`Step ${idx + 1} of ${ORDER.length}`}>
          {ORDER.map((s, i) => (
            <span key={s} className={cn("h-1 rounded-full transition-all duration-300", i <= idx ? "w-6 bg-fg" : "w-3 bg-border-strong")} />
          ))}
        </div>
      </header>

      <main className="relative mx-auto flex max-w-3xl flex-col px-6 pb-16 pt-6 sm:pt-12">
        {step === "welcome" && (
          <section className="mx-auto max-w-xl text-center animate-rise">
            <div className="mx-auto mb-6 flex w-fit -space-x-2">
              {[...AGENTS.slice(0, 5), BUSINESS_AGENT].map((a, i) => (
                <span key={a.id} className="grid size-10 place-items-center rounded-full border-2 border-bg bg-surface shadow-xs animate-rise" style={{ animationDelay: `${i * 60}ms`, color: a.hue }}>
                  <a.icon className="size-4" />
                </span>
              ))}
            </div>
            <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.035em] sm:text-[40px]">
              Welcome{firstName ? `, ${firstName}` : ""}.<br />Meet your AI Operations Team.
            </h1>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-fg-2">
              Ten specialised agents will each watch one part of your business — orders, customers, reviews, support, products, inventory, pricing, marketing, finance and the market — and a Business Insights agent will tell you what to do next.
            </p>
            <Button variant="primary" size="lg" className="mt-8" onClick={() => setStep("business")}>Get started <ArrowRight /></Button>
          </section>
        )}

        {step === "business" && (
          <section className="animate-rise">
            <h2 className="text-[26px] font-semibold tracking-[-0.03em]">What kind of business do you run?</h2>
            <p className="mt-1.5 text-[14px] text-fg-2">Agents tune their benchmarks, return expectations and seasonality to your category.</p>
            <div role="radiogroup" className="mt-7 grid gap-2.5 sm:grid-cols-2">
              {BUSINESS.map((b) => (
                <button key={b.id} role="radio" aria-checked={business === b.id} onClick={() => setBusiness(b.id)}
                  className={cn("flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-xs transition-all hover:border-border-strong",
                    business === b.id && "border-fg ring-1 ring-fg")}>
                  <span className="grid size-9 place-items-center rounded-lg bg-surface-3 text-fg-2"><b.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{b.label}</span>
                    <span className="block text-[12.5px] text-fg-3">{b.hint}</span>
                  </span>
                  {business === b.id && <Check className="size-4" />}
                </button>
              ))}
            </div>
            <div className="mt-8 flex justify-between">
              <Button variant="ghost" onClick={() => (params.get("step") ? router.back() : setStep("welcome"))}><ArrowLeft /> Back</Button>
              <Button variant="primary" onClick={() => setStep("connect")}>Continue <ArrowRight /></Button>
            </div>
          </section>
        )}

        {step === "connect" && (
          <section className="animate-rise">
            <h2 className="text-[26px] font-semibold tracking-[-0.03em]">Connect your store</h2>
            <p className="mt-1.5 text-[14px] text-fg-2">Agents only need read access. Start with the demo store to see everything working right away.</p>
            <div role="radiogroup" className="mt-7 grid gap-2.5 sm:grid-cols-2">
              {PLATFORMS.map((p) => (
                <button key={p.id} role="radio" aria-checked={platform === p.id} disabled={!p.available} onClick={() => setPlatform(p.id)}
                  className={cn("relative flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-xs transition-all",
                    p.available ? "hover:border-border-strong" : "cursor-not-allowed opacity-60",
                    platform === p.id && "border-fg ring-1 ring-fg")}>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", p.id === "demo" ? "bg-accent-soft text-accent" : "bg-surface-3 text-fg-2")}><p.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[14px] font-medium">
                      {p.label}
                      {p.id === "demo" && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-text">Recommended</span>}
                      {!p.available && <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10.5px] font-medium text-fg-3">Coming soon</span>}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-3">{p.desc}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-6 max-w-sm space-y-1.5">
              <Label htmlFor="sname">Store name <span className="font-normal text-fg-3">(optional)</span></Label>
              <Input id="sname" maxLength={80} value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="We'll name your demo store for you" />
            </div>
            <div className="mt-8 flex justify-between">
              <Button variant="ghost" onClick={() => setStep("business")}><ArrowLeft /> Back</Button>
              <Button variant="primary" onClick={() => setStep("init")}>Connect & initialise agents <ArrowRight /></Button>
            </div>
          </section>
        )}

        {step === "init" && (
          <section className="mx-auto w-full max-w-lg animate-rise">
            <h2 className="text-[26px] font-semibold tracking-[-0.03em]">Initialising your agents</h2>
            <p className="mt-1.5 text-[14px] text-fg-2">Importing store data and running the first full analysis.</p>
            <ol className="mt-8 rounded-xl border border-border bg-surface p-2 font-mono text-[12.5px] shadow-xs">
              {INIT_STEPS.map((s, i) => {
                const done = i < progress;
                const running = i === progress && !error;
                return (
                  <li key={s} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 transition-colors", running && "bg-surface-3", i > progress && "opacity-40")}>
                    <span className="min-w-0 flex-1 truncate">
                      {s} <span className="text-fg-3">{".".repeat(Math.max(3, 34 - s.length))}</span>
                    </span>
                    {done ? <Check className="size-4 text-good-text animate-fade-in" strokeWidth={3} />
                      : running ? <span className="size-3.5 animate-spin rounded-full border-2 border-border-strong border-t-fg" />
                      : <span className="size-3.5" />}
                  </li>
                );
              })}
            </ol>
            {error && (
              <div role="alert" className="mt-4 rounded-lg bg-crit-soft p-3 text-[13px] text-crit-text">
                <div className="font-medium">{error.message}</div>
                {error.hint && <div className="mt-0.5">{error.hint}</div>}
                <Button size="sm" className="mt-3" onClick={() => setStep("connect")}>Go back</Button>
              </div>
            )}
          </section>
        )}

        {step === "ready" && (
          <section className="mx-auto max-w-xl text-center animate-rise">
            <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-good-soft text-good-text"><Check className="size-7" strokeWidth={2.5} /></div>
            <h2 className="text-[32px] font-semibold tracking-[-0.035em]">Your AI operations team is ready.</h2>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-fg-2">
              {create.data?.store.name ?? "Your store"} is connected. Agents have completed their first analysis and already found things that need your attention.
            </p>
            <div className="mx-auto mt-8 grid max-w-md grid-cols-5 gap-2">
              {AGENTS.map((a, i) => (
                <span key={a.id} className="flex flex-col items-center gap-1 animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="grid size-10 place-items-center rounded-xl border border-border bg-surface" style={{ color: a.hue }}><a.icon className="size-4" /></span>
                  <span className="text-[10px] leading-tight text-fg-3">{a.short.split(" ")[0]}</span>
                </span>
              ))}
            </div>
            <Button variant="primary" size="lg" className="mt-10" onClick={() => router.replace("/dashboard")}>Open command center <ArrowRight /></Button>
          </section>
        )}
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  );
}
