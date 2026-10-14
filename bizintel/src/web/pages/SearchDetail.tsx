import { lazy, Suspense, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bookmark, BookmarkCheck, Clock, Map as MapIcon, MapPin, Pencil, RotateCw, Ruler, Shapes } from "lucide-react";
import { DEPTH_INFO, fromMeters } from "@shared/domain";
import { industryLabel } from "@shared/industries";
import { api, errorMessage } from "@/lib/api";
import { isActive, keys, useBusinesses, useConfig, useInvalidate, useSearch } from "@/lib/queries";
import { dateTime, relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { Button, ButtonLink } from "@/components/ui/Button";
import { BlockSkeleton, EmptyState, ErrorState, InlineAlert } from "@/components/ui/States";
import { Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { SearchStatusBadge } from "@/components/business/badges";
import { SearchProgress } from "@/components/search/SearchProgress";
import { BusinessTable } from "@/components/business/BusinessTable";
import { Building2 } from "lucide-react";

const MapPreview = lazy(() => import("@/components/search/MapPreview"));

export default function SearchDetail() {
  const { id = "" } = useParams();
  const { data: cfg } = useConfig();
  const { data: s, isLoading, isError, error, refetch } = useSearch(id);
  useCrumbs([{ label: "Search History", to: "/searches" }, { label: s?.name ?? "Search" }], cfg?.branding.productName);
  const inv = useInvalidate();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const running = isActive(s);
  const mapData = useBusinesses({ searchId: id, pageSize: 200, sort: "distance" }, { poll: false });
  const points = useMemo(() => (mapData.data?.items ?? []).map((b) => ({ id: b.id, lat: b.lat, lon: b.lon, label: b.name })), [mapData.data]);

  if (isLoading) return <PageBody wide><BlockSkeleton lines={8} /></PageBody>;
  if (isError || !s) return <PageBody><ErrorState error={error} onRetry={() => refetch()} /></PageBody>;

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.post(`/searches/${id}/cancel`);
      await inv(keys.search(id), keys.overview);
      toast.info("Search cancelled", "Businesses already discovered remain available.");
    } catch (e) {
      toast.error("Couldn’t cancel", errorMessage(e));
    } finally {
      setCancelling(false);
      setConfirmCancel(false);
    }
  };

  const patch = async (body: { name?: string; saved?: boolean }, msg: string) => {
    try {
      await api.patch(`/searches/${id}`, body);
      await inv(keys.search(id), keys.searches);
      toast.success(msg);
    } catch (e) {
      toast.error("Couldn’t update the search", errorMessage(e));
    }
  };

  const retry = async () => {
    setRetrying(true);
    try {
      const r = await api.post<{ queued: string[] }>(`/searches/${id}/retry-failed`);
      await inv(["businesses"], keys.jobs);
      toast.success(`${r.queued.length} research job(s) queued for failed businesses`);
    } catch (e) {
      toast.error("Couldn’t retry", errorMessage(e));
    } finally {
      setRetrying(false);
    }
  };

  const radius = fromMeters(s.radiusMeters, s.unit);
  const c = s.counters;
  const partial = running || s.status === "cancelled" || s.status === "failed";

  return (
    <PageBody wide>
      <PageHeader
        title={s.name}
        meta={
          <>
            <SearchStatusBadge status={s.status} />
            <span className="inline-flex items-center gap-1">
              <MapPin size={13} className="text-fg-3" /> {s.location.label}
            </span>
            <span className="inline-flex items-center gap-1 tnum">
              <Ruler size={13} className="text-fg-3" /> {radius < 10 ? radius.toFixed(1) : Math.round(radius)} {s.unit} radius
            </span>
            <span className="inline-flex items-center gap-1">
              <Shapes size={13} className="text-fg-3" /> {s.industries.length ? s.industries.map(industryLabel).join(", ") : "All industries"}
            </span>
            <span>{DEPTH_INFO[s.depth].label}</span>
            <span className="inline-flex items-center gap-1 text-fg-3" title={dateTime(s.finishedAt ?? s.startedAt ?? s.createdAt)}>
              <Clock size={13} /> Updated {relativeTime(s.finishedAt ?? s.startedAt ?? s.createdAt)}
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" icon={<Pencil size={14} />} onClick={() => (setName(s.name), setRenaming(true))}>
              Rename
            </Button>
            <Button size="sm" icon={s.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />} onClick={() => patch({ saved: !s.saved }, s.saved ? "Search unsaved" : "Search saved")}>
              {s.saved ? "Saved" : "Save search"}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                try {
                  sessionStorage.setItem(
                    "discover-draft",
                    JSON.stringify({ location: s.location, alternatives: [], radius: Number(radius.toFixed(1)), unit: s.unit, unitTouched: true, industries: s.industries, depth: s.depth, name: "", maxBusinesses: String(s.maxBusinesses) }),
                  );
                } catch {
                  /* ignore */
                }
                navigate("/discover");
              }}
            >
              Modify &amp; re-run
            </Button>
          </>
        }
      />

      <div className="space-y-5">
        {s.error && (
          <InlineAlert tone="danger" title="The search stopped with an error">
            {s.error}
          </InlineAlert>
        )}

        <SearchProgress search={s} onCancel={() => setConfirmCancel(true)} cancelling={cancelling} />

        {c.failed > 0 && !running && (
          <InlineAlert tone="warning" title={`${c.failed} business${c.failed === 1 ? "" : "es"} could not be fully researched`} action={<Button size="sm" icon={<RotateCw size={14} />} loading={retrying} onClick={retry}>Retry failed</Button>}>
            Websites may have blocked automated access or timed out. All other results are available below.
          </InlineAlert>
        )}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="t-section-title">
              Results {partial && c.unique > 0 && <span className="ml-1 text-sm font-normal text-warning">· {running ? "partial — still running" : "incomplete"}</span>}
            </h2>
            {c.unique > 0 && (
              <Button size="sm" variant="ghost" icon={<MapIcon size={14} />} onClick={() => setShowMap((m) => !m)} aria-expanded={showMap}>
                {showMap ? "Hide map" : "Show map"}
              </Button>
            )}
          </div>
          {showMap && (
            <div className="mb-3 overflow-hidden rounded-lg border border-border">
              <Suspense fallback={<Skeleton className="h-[320px] w-full rounded-none" />}>
                <MapPreview lat={s.location.lat} lon={s.location.lon} radiusMeters={s.radiusMeters} points={points} height={320} onPointClick={(bid) => navigate(`/businesses/${bid}`)} />
              </Suspense>
              {mapData.data && mapData.data.total > points.length && <p className="border-t border-border px-3 py-1.5 t-meta">Showing the {points.length} closest of {mapData.data.total}.</p>}
            </div>
          )}
          <BusinessTable
            fixed={{ searchId: id }}
            unit={s.unit}
            poll={running}
            defaultSort="distance"
            exportScope={{ kind: "search", searchId: id }}
            exportScopeLabel={`Results of “${s.name}”`}
            emptyState={
              running ? (
                <EmptyState icon={<Building2 size={18} />} title="No businesses yet" description="Results appear here as soon as discovery finishes. You can leave this page — the search keeps running." />
              ) : (
                <EmptyState
                  icon={<Building2 size={18} />}
                  title="This search found no businesses"
                  description="Try a larger radius or more industries. Map data coverage varies by region."
                  action={<ButtonLink to="/discover" variant="primary">New search</ButtonLink>}
                />
              )
            }
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancel}
        loading={cancelling}
        tone="danger"
        title="Cancel this search?"
        description="Work in progress stops. Businesses already discovered and any completed research are kept."
        confirmLabel="Cancel search"
      />
      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename search"
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim()} onClick={() => patch({ name: name.trim() }, "Search renamed").then(() => setRenaming(false))}>
              Save
            </Button>
          </>
        }
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Search name" data-autofocus />
      </Dialog>
    </PageBody>
  );
}
