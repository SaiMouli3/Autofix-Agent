import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Shell } from "../components/Shell";
import { ErrorBox, Loading, Modal, Notice, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useSession } from "../lib/session";

export default function Team() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"users" | "teams">("users");
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get("/api/users") });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.get("/api/teams") });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api.get("/api/roles") });
  const [invite, setInvite] = useState(false);
  const [newTeam, setNewTeam] = useState(false);
  const [temp, setTemp] = useState<any>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["teams"] }); };
  const setRole = useMutation({ mutationFn: ({ id, role }: any) => api.put(`/api/users/${id}/role`, { role }), onSuccess: () => { refresh(); toast("ok", "Role updated"); }, onError: (e: any) => toast("error", e.message) });
  const setActive = useMutation({ mutationFn: ({ id, is_active }: any) => api.put(`/api/users/${id}/active`, { is_active }), onSuccess: refresh, onError: (e: any) => toast("error", e.message) });
  const addMember = useMutation({ mutationFn: ({ team, user }: any) => api.post(`/api/teams/${team}/members`, { user_id: user }), onSuccess: refresh });
  const rmMember = useMutation({ mutationFn: ({ team, user }: any) => api.del(`/api/teams/${team}/members/${user}`), onSuccess: refresh });
  return (
    <Shell title="Team Management">
      <div className="page-head">
        <div><h1>Team management</h1><p>Role-based access is enforced on every API call. Organization Administrators manage providers and users; Agent Administrators manage agents and integrations; Operators run tasks; Approvers decide approvals; Viewers have read-only access.</p></div>
        <div className="row">
          {can("teams:write") && <button className="btn" onClick={() => setNewTeam(true)}><Plus /> New team</button>}
          {can("users:write") && <button className="btn primary" onClick={() => setInvite(true)}><UserPlus /> Add user</button>}
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "users", label: "Users", count: users.data?.length }, { key: "teams", label: "Teams", count: teams.data?.length }]} />
      {tab === "users" && (
        <div className="card flush">
          {users.isLoading ? <Loading /> : (
            <table className="table">
              <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>{(users.data ?? []).map((u: any) => (
                <tr key={u.user_id}>
                  <td><b className="small">{u.name}</b><div className="faint tiny">{u.email}</div></td>
                  <td>{can("users:write") ? (
                    <select value={u.role} onChange={(e) => setRole.mutate({ id: u.user_id, role: e.target.value })} style={{ width: 230 }} aria-label={`role for ${u.name}`}>
                      {(roles.data ?? []).map((r: any) => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>) : <span className="badge outline">{u.role_label}</span>}</td>
                  <td><span className={`badge ${u.is_active ? "active" : "disabled"}`}>{u.is_active ? "active" : "deactivated"}</span></td>
                  <td className="faint small">{timeAgo(u.last_login_at)}</td>
                  <td>{can("users:write") && u.user_id !== me.user.id && (
                    <button className="btn xs ghost" onClick={() => setActive.mutate({ id: u.user_id, is_active: !u.is_active })}>{u.is_active ? "Deactivate" : "Reactivate"}</button>)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
      {tab === "teams" && (
        <div className="grid cards">
          {(teams.data ?? []).length === 0 && <div className="card faint small">No teams yet. Teams group people and own agents.</div>}
          {(teams.data ?? []).map((t: any) => (
            <div className="card" key={t.id}>
              <b>{t.name}</b><div className="faint small">{t.description || "—"}</div>
              <div className="pill-list mt16">{t.members.map((m: any) => (
                <span key={m.id} className="badge outline">{m.name}{can("teams:write") && <button aria-label={`remove ${m.name}`} onClick={() => rmMember.mutate({ team: t.id, user: m.id })} style={{ background: "none", border: 0, cursor: "pointer", color: "inherit", padding: 0 }}><X size={12} /></button>}</span>
              ))}</div>
              {can("teams:write") && (
                <select className="mt16" value="" onChange={(e) => e.target.value && addMember.mutate({ team: t.id, user: e.target.value })} aria-label="Add member">
                  <option value="">Add member…</option>
                  {(users.data ?? []).filter((u: any) => !t.members.some((m: any) => m.id === u.user_id)).map((u: any) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
      {invite && <InviteUser roles={roles.data ?? []} onClose={() => setInvite(false)} onDone={(r) => { setInvite(false); refresh(); if (r.temporary_password) setTemp(r); }} />}
      {newTeam && <NewTeam onClose={() => setNewTeam(false)} onDone={() => { setNewTeam(false); refresh(); }} />}
      {temp && (
        <Modal title="User added" onClose={() => setTemp(null)} footer={<button className="btn primary" onClick={() => setTemp(null)}>Done</button>}>
          <Notice kind="warn">Share this one-time password with {temp.name} over a secure channel. It is not shown again, and they must change it after signing in.</Notice>
          <input readOnly className="mono mt16" value={temp.temporary_password} />
        </Modal>
      )}
    </Shell>
  );
}

function InviteUser({ roles, onClose, onDone }: { roles: any[]; onClose: () => void; onDone: (r: any) => void }) {
  const [f, setF] = useState({ email: "", name: "", role: "operator", password: "" });
  const m = useMutation({ mutationFn: () => api.post("/api/users", { ...f, password: f.password || null }), onSuccess: onDone });
  return (
    <Modal title="Add user" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.email || !f.name} onClick={() => m.mutate()}>Add user</button></>}>
      <div className="form-grid">
        <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        <label className="field">Initial password (optional)<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /><span className="help">Leave blank to generate a one-time password.</span></label>
      </div>
      <div className="mt16"><ErrorBox error={m.error} /></div>
    </Modal>
  );
}

function NewTeam({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", description: "" });
  const m = useMutation({ mutationFn: () => api.post("/api/teams", f), onSuccess: onDone });
  return (
    <Modal title="New team" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={f.name.length < 2} onClick={() => m.mutate()}>Create</button></>}>
      <div className="stack">
        <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Description<textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}
