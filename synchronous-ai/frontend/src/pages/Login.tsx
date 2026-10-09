import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { BRAND } from "../brand";
import { ErrorBox, Loading } from "../components/ui";
import { api } from "../lib/api";

export default function Login() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: () => api.get("/api/auth/status") });
  const [form, setForm] = useState({ org_name: "", name: "", email: "", password: "", bootstrap_token: "" });
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const setup = status.data?.needs_setup;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (setup) await api.post("/api/auth/setup", form);
      else await api.post("/api/auth/login", { email: form.email, password: form.password });
      qc.clear();
      window.location.href = "/";
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: any) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <div className="center-page">
      <div className="card login-card" style={{ padding: 28 }}>
        <div className="brand">
          <img src={BRAND.logo} alt="" />
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="brand-sub">{BRAND.tagline}</div>
          </div>
        </div>
        {status.isLoading ? (
          <Loading />
        ) : (
          <form className="stack" onSubmit={submit}>
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: 19 }}>{setup ? "Set up your organization" : "Sign in"}</h2>
              <p className="muted small" style={{ margin: 0 }}>
                {setup ? "Create the first administrator account. You can invite your team afterwards." : "Use your organization account."}
              </p>
            </div>
            {setup && (
              <>
                <label className="field">Organization name<input required minLength={2} {...f("org_name")} placeholder="Acme Consulting" /></label>
                <label className="field">Your name<input required {...f("name")} autoComplete="name" /></label>
              </>
            )}
            <label className="field">Email<input required type="email" autoComplete="email" {...f("email")} /></label>
            <label className="field">
              Password
              <input required type="password" autoComplete={setup ? "new-password" : "current-password"} {...f("password")} />
              {setup && <span className="help">At least 12 characters mixing upper/lowercase, digits or symbols.</span>}
            </label>
            {setup && status.data?.bootstrap_token_required && (
              <label className="field">Bootstrap token<input required {...f("bootstrap_token")} /><span className="help">Provided by whoever deployed this instance (SCA_BOOTSTRAP_TOKEN).</span></label>
            )}
            <ErrorBox error={err} title={setup ? "Setup failed" : "Sign-in failed"} />
            <button className="btn primary block" disabled={busy} style={{ height: 40 }}>
              {setup ? <Sparkles /> : <LogIn />} {busy ? "Please wait…" : setup ? "Create organization" : "Sign in"}
            </button>
          </form>
        )}
        <p className="faint tiny mt16" style={{ marginBottom: 0 }}>{BRAND.legal}</p>
      </div>
    </div>
  );
}
