"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api";
import { TooltipProvider } from "@/components/ui/misc";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster position="bottom-right" toastOptions={{ className: "!bg-surface !border-border !text-fg !shadow-pop !rounded-xl !text-[13px]" }} />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
