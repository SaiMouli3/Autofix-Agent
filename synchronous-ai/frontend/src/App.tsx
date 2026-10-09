import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { LiveProvider } from "./components/Shell";
import { Loading } from "./components/ui";
import { api } from "./lib/api";
import { Me, SessionContext } from "./lib/session";
import AgentWorkspace from "./pages/AgentWorkspace";
import Agents from "./pages/Agents";
import Approvals from "./pages/Approvals";
import Audit from "./pages/Audit";
import CreateAgent from "./pages/CreateAgent";
import Integrations from "./pages/Integrations";
import Knowledge from "./pages/Knowledge";
import Login from "./pages/Login";
import Monitoring from "./pages/Monitoring";
import Overview from "./pages/Overview";
import Schedules from "./pages/Schedules";
import SettingsPage from "./pages/Settings";
import TaskDetail from "./pages/TaskDetail";
import Tasks from "./pages/Tasks";
import Team from "./pages/Team";
import Workspaces from "./pages/Workspaces";

export default function App() {
  const loc = useLocation();
  const nav = useNavigate();
  const me = useQuery<Me>({ queryKey: ["me"], queryFn: () => api.get("/api/auth/me"), retry: false, enabled: loc.pathname !== "/login" });

  useEffect(() => {
    const h = () => nav("/login");
    window.addEventListener("sca:unauthorized", h);
    return () => window.removeEventListener("sca:unauthorized", h);
  }, [nav]);

  if (loc.pathname === "/login") return <Login />;
  if (me.isLoading) return <div className="center-page"><Loading label="Loading workspace…" /></div>;
  if (me.isError || !me.data) return <Navigate to="/login" replace />;

  const can = (p: string) => me.data!.permissions.includes(p);
  return (
    <SessionContext.Provider value={{ me: me.data, can }}>
      <LiveProvider>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agents/new" element={<CreateAgent />} />
          <Route path="/agents/:agentId" element={<AgentWorkspace />} />
          <Route path="/agents/:agentId/:tab" element={<AgentWorkspace />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/:taskId" element={<TaskDetail />} />
          <Route path="/workspaces" element={<Workspaces />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </LiveProvider>
    </SessionContext.Provider>
  );
}
