import { Component, lazy, Suspense, type ReactNode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { BlockSkeleton, ErrorState } from "./components/ui/States";

const Overview = lazy(() => import("./pages/Overview"));
const Discover = lazy(() => import("./pages/Discover"));
const SearchDetail = lazy(() => import("./pages/SearchDetail"));
const SearchHistory = lazy(() => import("./pages/SearchHistory"));
const Businesses = lazy(() => import("./pages/Businesses"));
const Company = lazy(() => import("./pages/Company"));
const Research = lazy(() => import("./pages/Research"));
const Opportunities = lazy(() => import("./pages/Opportunities"));
const Lists = lazy(() => import("./pages/Lists"));
const ListDetail = lazy(() => import("./pages/ListDetail"));
const Outreach = lazy(() => import("./pages/Outreach"));
const OutreachEditor = lazy(() => import("./pages/OutreachEditor"));
const Exports = lazy(() => import("./pages/Exports"));
const DataSources = lazy(() => import("./pages/DataSources"));
const Settings = lazy(() => import("./pages/Settings"));
const Help = lazy(() => import("./pages/Help"));
const NotFound = lazy(() => import("./pages/NotFound"));

class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) return <ErrorState title="This page failed to render" error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

export function App() {
  const location = useLocation();
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          path="*"
          element={
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<div className="mx-auto max-w-content px-6 py-6"><BlockSkeleton lines={6} /></div>}>
                <Routes>
                  <Route index element={<Overview />} />
                  <Route path="discover" element={<Discover />} />
                  <Route path="searches" element={<SearchHistory />} />
                  <Route path="searches/:id" element={<SearchDetail />} />
                  <Route path="businesses" element={<Businesses />} />
                  <Route path="businesses/:id/:tab?" element={<Company />} />
                  <Route path="research" element={<Research />} />
                  <Route path="opportunities" element={<Opportunities />} />
                  <Route path="lists" element={<Lists />} />
                  <Route path="lists/:id" element={<ListDetail />} />
                  <Route path="outreach" element={<Outreach />} />
                  <Route path="outreach/:draftId" element={<OutreachEditor />} />
                  <Route path="exports" element={<Exports />} />
                  <Route path="data-sources" element={<DataSources />} />
                  <Route path="settings/:tab?" element={<Settings />} />
                  <Route path="help" element={<Help />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          }
        />
      </Route>
    </Routes>
  );
}
