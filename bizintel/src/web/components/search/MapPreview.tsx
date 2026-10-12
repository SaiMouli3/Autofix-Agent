import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  label: string;
}

/** Lazy-loaded map. Shows the search center, radius and (optionally) result points. */
export default function MapPreview({ lat, lon, radiusMeters, points = [], onPointClick, height = 280 }: { lat: number; lon: number; radiusMeters: number; points?: MapPoint[]; onPointClick?: (id: string) => void; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const primary = getComputedStyle(document.documentElement).getPropertyValue("--c-primary").trim().split(" ").join(",");
    const circle = L.circle([lat, lon], { radius: radiusMeters, color: `rgb(${primary})`, weight: 1.5, fillOpacity: 0.06 }).addTo(g);
    L.circleMarker([lat, lon], { radius: 5, color: "#fff", weight: 2, fillColor: `rgb(${primary})`, fillOpacity: 1 }).addTo(g).bindTooltip("Search center");
    for (const p of points) {
      const mk = L.circleMarker([p.lat, p.lon], { radius: 4, color: `rgb(${primary})`, weight: 1, fillColor: `rgb(${primary})`, fillOpacity: 0.55 }).addTo(g).bindTooltip(p.label);
      if (onPointClick) mk.on("click", () => onPointClick(p.id));
    }
    m.fitBounds(circle.getBounds(), { padding: [12, 12] });
  }, [lat, lon, radiusMeters, points, onPointClick]);

  return <div ref={el} style={{ height }} className="w-full rounded-md" role="img" aria-label={`Map of the search area: ${(radiusMeters / 1000).toFixed(1)} km radius${points.length ? `, ${points.length} businesses plotted` : ""}`} />;
}
