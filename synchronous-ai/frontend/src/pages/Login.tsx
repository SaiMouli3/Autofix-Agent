import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { CheckCircle2, KeyRound, ScrollText } from "lucide-react";
import { BRAND } from "../brand";
import { AuthScene } from "../components/AuthScene";
import { InlineError, Spinner } from "../components/ui";
import { api } from "../lib/api";

export default function Login() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: ({ signal }) => api.get("/api/auth/status", signal) });
  const [form, setForm] = useState({ org_name: "", name: "", email: "", password: "", bootstrap_token: "" });
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const setup = status.data?.needs_setup;
  const next = new URLSearchParams(window.location.search).get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const expired = !!next && !setup;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (setup) await api.post("/api/auth/setup", form);
      else await api.post("/api/auth/login", { email: form.email, password: form.password });
      qc.clear();
      window.location.href = setup ? "/" : safeNext;
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: any) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <main className="auth">
      <section className="auth-hero" aria-label={`${BRAND.name} overview`}>
        <div className="auth-hero-brand">
          <img src={BRAND.logo} alt="" width={32} height={32} />
          <span>{BRAND.name}</span>
        </div>
        <div className="auth-hero-copy">
          <h2>Your AI workforce,<br /><em>governed.</em></h2>
          <p>Agents that work across Salesforce, SAP, Slack, Microsoft 365 and 20 more systems. Every change is approved, every action audited.</p>
        </div>
        <AuthScene />
        <ul className="auth-trust">
          <li><CheckCircle2 aria-hidden /> Human approval before any change</li>
          <li><ScrollText aria-hidden /> Tamper-evident audit trail</li>
          <li><KeyRound aria-hidden /> Credentials encrypted, never exposed</li>
        </ul>
      </section>
      <section className="auth-side">
        <div className="auth-card">
          <div className="row auth-card-brand" style={{ gap: 10, marginBottom: 28 }}>
            <img src={BRAND.logo} alt="" width={30} height={30} />
            <div>
              <div className="strong">{BRAND.name}</div>
              <div className="tiny muted">{BRAND.tagline}</div>
            </div>
          </div>
          {status.isLoading ? <Spinner /> : (
            <form className="stack" onSubmit={submit} noValidate={false}>
              <div>
                <h1 className="auth-title">{setup ? "Set up your organization" : "Welcome back"}</h1>
                <p className="muted small" style={{ margin: "6px 0 0" }}>
                  {setup ? "Create the first administrator. You can invite your team afterwards." : expired ? "Your session ended. Sign in to continue where you left off." : "Sign in with your organization account."}
                </p>
              </div>
              {setup && (
                <>
                  <label className="field"><span className="req">Organization name</span><input required minLength={2} {...f("org_name")} autoComplete="organization" /></label>
                  <label className="field"><span className="req">Your name</span><input required {...f("name")} autoComplete="name" /></label>
                </>
              )}
              <label className="field"><span className="req">Email</span><input required type="email" autoComplete="email" {...f("email")} placeholder="you@company.com" /></label>
              <label className="field">
                <span className="req">Password</span>
                <input required type="password" autoComplete={setup ? "new-password" : "current-password"} {...f("password")} minLength={setup ? 12 : undefined} />
                {setup && <span className="help">At least 12 characters, mixing upper/lowercase, digits or symbols.</span>}
              </label>
              {setup && status.data?.bootstrap_token_required && (
                <label className="field"><span className="req">Bootstrap token</span><input required {...f("bootstrap_token")} autoComplete="off" />
                  <span className="help">Provided by whoever deployed this instance.</span></label>
              )}
              <InlineError error={err} />
              <button className="btn dark block auth-submit" disabled={busy}>
                {busy ? <Spinner label="Please wait" /> : setup ? "Create organization" : "Sign in"}
              </button>
              {!setup && <p className="tiny muted" style={{ margin: 0 }}>Forgot your password? Ask an organization administrator to reset it in Settings → Team.</p>}
            </form>
          )}
        </div>
        <p className="tiny faint auth-legal">{BRAND.legal}</p>
      </section>
    </main>
  );
}
