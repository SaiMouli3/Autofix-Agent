import { AuthVisual } from "@/components/auth/auth-visual";
import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-[11.5px] text-fg-3">© {new Date().getFullYear()} E-commerce AI OS · Data encrypted in transit · Workspace-isolated by design</p>
      </div>
      <div className="hidden border-l border-border bg-surface-2 lg:block">
        <AuthVisual />
      </div>
    </div>
  );
}
