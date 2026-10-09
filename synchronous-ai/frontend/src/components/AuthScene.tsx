import { useEffect, useRef } from "react";
import { BRAND } from "../brand";
import { BrandLogo } from "./BrandLogo";
import { BotMark } from "./BotMark";

/**
 * Isometric "control room" for the sign-in page, drawn with CSS 3D transforms (no WebGL, no
 * images to download). An orchestrator hub sits in the middle; connector tiles stand on a ring,
 * linked to it by lines that carry data pulses; agent bots float above. Purely decorative: it
 * shows no live data. Motion stops under prefers-reduced-motion, and pointer parallax is skipped.
 */

const RING = ["salesforce", "slack", "sap_s4hana", "gmail", "microsoft_365", "hubspot", "shopify_admin", "jira"];
const NAMES: Record<string, string> = {
  salesforce: "Salesforce", slack: "Slack", sap_s4hana: "SAP", gmail: "Gmail", microsoft_365: "Microsoft 365",
  hubspot: "HubSpot", shopify_admin: "Shopify", jira: "Jira",
};
const STAGE = 520;
const R = 205;
const AGENTS = [
  { seed: "finance-agent", label: "Finance agent", angle: 232, r: 178, z: 60 },
  { seed: "support-agent", label: "Support agent", angle: 290, r: 150, z: 96 },
  { seed: "sales-agent", label: "Sales agent", angle: 350, r: 178, z: 60 },
];

function Box({ x, y, w, d, h, className, children }: { x: number; y: number; w: number; d: number; h: number; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`iso-box ${className ?? ""}`} style={{ width: w, height: d, transform: `translate3d(${x - w / 2}px, ${y - d / 2}px, 0)` }}>
      <div className="iso-face iso-front" style={{ width: w, height: h, top: d }} />
      <div className="iso-face iso-right" style={{ width: h, height: d, left: w }} />
      <div className="iso-face iso-top" style={{ transform: `translateZ(${h}px)` }}>{children}</div>
    </div>
  );
}

export function AuthScene() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const px = e.clientX / window.innerWidth - 0.5;
        const py = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty("--rx", `${58 - py * 6}deg`);
        el.style.setProperty("--rz", `${-40 + px * 8}deg`);
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(frame); };
  }, []);

  const c = STAGE / 2;
  return (
    <div className="iso-scene" ref={ref} aria-hidden>
      <div className="iso-stage" style={{ width: STAGE, height: STAGE }}>
        <div className="iso-floor" />
        <div className="iso-glow" />
        <div className="iso-ring" style={{ width: R * 2, height: R * 2, left: c - R, top: c - R }} />
        {RING.map((key, i) => {
          const a = (i / RING.length) * 360;
          return (
            <div key={`l-${key}`} className="iso-line" style={{ left: c, top: c, width: R - 40, transform: `rotate(${a}deg) translateX(40px)` }}>
              <span className="iso-packet" style={{ animationDelay: `${(i * 0.37) % 2.4}s` }} />
              <span className="iso-packet out" style={{ animationDelay: `${(i * 0.53 + 1.1) % 2.4}s` }} />
            </div>
          );
        })}
        <Box x={c} y={c} w={104} d={104} h={26} className="hub">
          <div className="iso-hub-top"><img src={BRAND.logo} alt="" width={74} height={74} /></div>
        </Box>
        <div className="iso-pulse" style={{ left: c, top: c }} />
        {RING.map((key, i) => {
          const a = (i / RING.length) * Math.PI * 2;
          return (
            <Box key={key} x={c + Math.cos(a) * R} y={c + Math.sin(a) * R} w={62} d={62} h={14} className="tile">
              <div className="iso-tile-top" title={NAMES[key]}><BrandLogo connectorKey={key} name={NAMES[key]} size={48} /></div>
            </Box>
          );
        })}
        {AGENTS.map((g) => {
          const a = (g.angle * Math.PI) / 180;
          return (
            <div key={g.seed} className="iso-billboard" style={{ left: c + Math.cos(a) * g.r, top: c + Math.sin(a) * g.r, ["--z" as any]: `${g.z}px` }}>
              <div className="iso-bob">
                <div className="iso-agent">
                  <BotMark seed={g.seed} size={26} state="running" />
                  <span>{g.label}</span>
                </div>
                <div className="iso-tether" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
