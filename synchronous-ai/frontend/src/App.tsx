import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { LiveProvider } from "./components/Shell";
import { ConfirmProvider, ErrorBoundary, Spinner } from "./components/ui";
import { api } from "./lib/api";
import { Me, SessionContext } from "./lib/session";
import Login from "./pages/Login";

// Route-level code splitting: each section loads on first visit.
const Overview = lazy(() => import("./pages/Overview"));
const Agents = lazy(() => import("./pages/Agents"));
const CreateAgent = lazy(() => import("./pages/CreateAgent"));
const AgentWorkspace = lazy(() => import("./pages/AgentWorkspace"));
const AgentSettings = lazy(() => import("./pages/AgentSettings"));
const Tasks = lazy(() => import("./pages/Tasks"));
const TaskDetail = lazy(() => import("./pages/TaskDetail"));
const Workspaces = lazy(() => import("./pages/Workspaces"));
const Integrations = lazy(() => import("./pages/Integrations"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const Workflows = lazy(() => import("./pages/Schedules"));
const Approvals = lazy(() => import("./pages/Approvals"));
const Monitoring = lazy(() => import("./pages/Monitoring"));
const SettingsPage = lazy(() => import("./pages/Settings"));

function Fallback() {
  return <div className="login"><Spinner label="Loading" /></div>;
}

export default function App() {
  const loc = useLocation();
  const nav = useNavigate();
  const me = useQuery<Me>({ queryKey: ["me"], queryFn: ({ signal }) => api.get("/api/auth/me", signal), retry: false, enabled: loc.pathname !== "/login", staleTime: 60_000 });

  useEffect(() => {
    const h = () => nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);
    window.addEventListener("sca:unauthorized", h);
    return () => window.removeEventListener("sca:unauthorized", h);
  }, [nav, loc.pathname, loc.search]);

  if (loc.pathname === "/login") return <Login />;
  if (me.isLoading) return <Fallback />;
  if (me.isError || !me.data) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;

  const can = (p: string) => me.data!.permissions.includes(p);
  return (
    <SessionContext.Provider value={{ me: me.data, can }}>
      <ConfirmProvider>
        <LiveProvider>
          <ErrorBoundary resetKey={loc.pathname}>
            <Suspense fallback={<Fallback />}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/agents/new" element={<CreateAgent />} />
                <Route path="/agents/:agentId" element={<AgentWorkspace />} />
                <Route path="/agents/:agentId/settings" element={<AgentSettings />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/tasks/:taskId" element={<TaskDetail />} />
                <Route path="/workspaces" element={<Workspaces />} />
                <Route path="/integrations" element={<Integrations />} />
                <Route path="/knowledge" element={<Knowledge />} />
                <Route path="/workflows" element={<Workflows />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/monitoring" element={<Monitoring />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/schedules" element={<Navigate to="/workflows" replace />} />
                <Route path="/audit" element={<Navigate to="/settings?tab=audit" replace />} />
                <Route path="/team" element={<Navigate to="/settings?tab=team" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </LiveProvider>
      </ConfirmProvider>
    </SessionContext.Provider>
  );
}
