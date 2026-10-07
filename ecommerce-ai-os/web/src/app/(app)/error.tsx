"use client";

import { ErrorState } from "@/components/states/states";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState error={error} onRetry={reset} />;
}
