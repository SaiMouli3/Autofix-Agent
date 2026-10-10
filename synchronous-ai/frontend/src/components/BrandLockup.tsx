import { BRAND } from "../brand";

/** The Synchronous mark with the two-line wordmark ("SYNCHRONOUS" / "CONSULTING INC"), as on sync-sap.com. */
export function BrandLockup({ size = 40, tone = "light", markOnly }: { size?: number; tone?: "light" | "dark"; markOnly?: boolean }) {
  return (
    <span className={`lockup lockup-${tone}`} style={{ ["--mark" as any]: `${size}px` }}>
      <img className="lockup-mark" src={BRAND.logo} alt="" width={size} height={size} />
      {!markOnly && (
        <span className="lockup-text">
          <span className="lockup-word">{BRAND.wordmark}</span>
          <span className="lockup-sub">{BRAND.subline}</span>
        </span>
      )}
    </span>
  );
}
