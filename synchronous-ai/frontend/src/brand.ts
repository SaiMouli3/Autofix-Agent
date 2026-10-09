/** Centralized product identity. Colours live as CSS tokens in styles.css (:root). */
export const BRAND = {
  name: "Synchronous Consulting AI",
  shortName: "Synchronous",
  tagline: "Enterprise autonomous agent workspace",
  /** Round mark from sync-sap.com (Synchronous Consulting Inc). */
  logo: "/brand/synchronous-logo.jpg",
  /** Two-line lockup used next to the mark, as on sync-sap.com. */
  wordmark: "SYNCHRONOUS",
  subline: "CONSULTING INC",
  legal:
    "Synchronous Consulting AI runs agents on the open-source OpenHands Software Agent SDK (MIT). " +
    "It is not affiliated with or endorsed by OpenHands, OpenAI, Anthropic, xAI or Experiential Labs.",
} as const;
