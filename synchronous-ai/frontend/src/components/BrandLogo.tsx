/**
 * Connector logos from Simple Icons (CC0-1.0, bundled at build time — nothing is fetched from
 * vendors at runtime). Logos are trademarks of their owners and are shown only to identify the
 * service a connector talks to. Brands whose owners asked Simple Icons to remove their marks
 * (e.g. Salesforce, Microsoft, Slack) are not included; those fall back to a neutral monogram.
 */
import {
  siAirtable, siGithub, siGmail, siGooglecalendar, siGoogledrive, siHubspot, siJira, siMeta, siNotion, siSap,
  siShopify, siStripe, siWhatsapp, siZendesk,
} from "simple-icons";

type Icon = { title: string; hex: string; path: string };

const BY_CONNECTOR: Record<string, Icon> = {
  shopify_admin: siShopify, shopify_dev_mcp: siShopify,
  meta_marketing: siMeta, meta_ads_mcp: siMeta, whatsapp_cloud: siWhatsapp,
  sap_s4hana: siSap, sap_api_sandbox: siSap,
  gmail: siGmail, google_calendar: siGooglecalendar, google_drive: siGoogledrive,
  notion: siNotion, airtable: siAirtable, hubspot: siHubspot, zendesk: siZendesk, jira: siJira,
  github: siGithub, github_mcp: siGithub, stripe: siStripe, stripe_mcp: siStripe,
};

const MONO_COLORS = ["#C65D32", "#4776A8", "#27845A", "#7A5BA6", "#9A6417", "#2F7F86", "#A04F6B", "#5B615C"];

export function hasLogo(connectorKey?: string | null): boolean {
  return !!connectorKey && connectorKey in BY_CONNECTOR;
}

/** Brand logo when available, otherwise a monogram from the name. Decorative: the name is always shown next to it. */
export function BrandLogo({ connectorKey, name, vendor, size = 32 }: { connectorKey?: string | null; name: string; vendor?: string; size?: number }) {
  const icon = connectorKey ? BY_CONNECTOR[connectorKey] : undefined;
  const radius = Math.round(size / 4);
  if (icon) {
    const pad = Math.round(size * 0.2);
    return (
      <span className="brand-logo" style={{ width: size, height: size, borderRadius: radius, padding: pad }} aria-hidden>
        <svg viewBox="0 0 24 24" width={size - pad * 2} height={size - pad * 2} fill={`#${icon.hex}`} focusable="false"><path d={icon.path} /></svg>
      </span>
    );
  }
  let h = 0;
  for (const ch of vendor || name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
  return (
    <span className="conn-logo" style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.38), background: MONO_COLORS[h % MONO_COLORS.length] }} aria-hidden>
      {letters}
    </span>
  );
}
