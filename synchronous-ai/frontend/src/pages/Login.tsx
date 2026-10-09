import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { BRAND } from "../brand";
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
    <main className="login">
      <div className="panel">
        <div className="row" style={{ gap: 10, marginBottom: 24 }}>
          <img src={BRAND.logo} alt="" width={30} height={30} />
          <div>
            <div className="strong">{BRAND.name}</div>
            <div className="tiny muted">{BRAND.tagline}</div>
          </div>
        </div>
        {status.isLoading ? <Spinner /> : (
          <form className="stack" onSubmit={submit} noValidate={false}>
            <div>
              <h1 style={{ fontSize: 20 }}>{setup ? "Set up your organization" : "Sign in"}</h1>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                {setup ? "Create the first administrator. You can invite your team afterwards." : expired ? "Your session ended. Sign in to continue where you left off." : "Use your organization account."}
              </p>
            </div>
            {setup && (
              <>
                <label className="field"><span className="req">Organization name</span><input required minLength={2} {...f("org_name")} autoComplete="organization" /></label>
                <label className="field"><span className="req">Your name</span><input required {...f("name")} autoComplete="name" /></label>
              </>
            )}
            <label className="field"><span className="req">Email</span><input required type="email" autoComplete="email" {...f("email")} /></label>
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
            <button className="btn dark block" disabled={busy} style={{ height: 36 }}>
              {busy ? <Spinner label="Please wait" /> : setup ? "Create organization" : "Sign in"}
            </button>
          </form>
        )}
        <p className="tiny faint" style={{ margin: "20px 0 0" }}>{BRAND.legal}</p>
      </div>
    </main>
  );
}
