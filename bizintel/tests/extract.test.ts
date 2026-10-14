import { describe, expect, it } from "vitest";
import { classifyPage, contactTypeFor, excerptIsGrounded, extractEmails, extractJsonLd, extractPhones, htmlToText } from "../src/server/research/extract";
import { planPages } from "../src/server/research/crawler";

describe("extractEmails", () => {
  it("finds mailto and plain-text addresses, ignoring assets and placeholders", () => {
    const html = `<a href="mailto:Info@Acme.com?subject=hi">Email</a> sales@acme.com logo@2x.png you@example.com office [at] acme [dot] com`;
    expect(extractEmails(html).sort()).toEqual(["info@acme.com", "office@acme.com", "sales@acme.com"]);
  });
  it("is stable across repeated calls (no global regex state)", () => {
    const html = "a@acme.com b@acme.com";
    expect(extractEmails(html)).toEqual(extractEmails(html));
  });
});

describe("extractPhones", () => {
  it("reads tel links and formatted numbers, ignoring bare digit runs", () => {
    const html = `<a href="tel:+15125550100">Call</a><p>Office: (512) 555-0199</p><p>Order #20240101123</p>`;
    const phones = extractPhones(html);
    expect(phones).toContain("+15125550100");
    expect(phones.some((p) => p.includes("555-0199"))).toBe(true);
    expect(phones.some((p) => p.includes("20240101123"))).toBe(false);
  });
});

describe("page classification", () => {
  it.each([
    ["https://x.com/", "home"],
    ["https://x.com/contact-us", "contact"],
    ["https://x.com/about", "about"],
    ["https://x.com/practice-areas", "services"],
    ["https://x.com/careers", "careers"],
    ["https://x.com/random", "other"],
  ])("%s → %s", (url, cat) => expect(classifyPage(url)).toBe(cat));

  it("plans at most one page per category, prioritizing contact/about", () => {
    const html = `<a href="/about">About</a><a href="/contact">Contact</a><a href="/contact-2">Contact</a><a href="/blog">Blog</a><a href="https://other.com/about">x</a>`;
    const plan = planPages(html, "https://x.com/", 3);
    expect(plan.map((p) => p.category)).toEqual(["contact", "about"]);
  });
});

describe("evidence grounding", () => {
  const text = "We are a family-owned bakery serving Austin since 1998.\nOrder online for pickup.";
  it("accepts excerpts that appear in the source", () => expect(excerptIsGrounded(text, "family-owned bakery serving Austin since 1998")).toBe(true));
  it("rejects fabricated excerpts", () => expect(excerptIsGrounded(text, "the largest bakery chain in Texas")).toBe(false));
  it("rejects trivially short excerpts", () => expect(excerptIsGrounded(text, "bakery")).toBe(false));
});

describe("misc extraction", () => {
  it("reads schema.org organization data", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"LocalBusiness","telephone":"+1 512 555 0100","numberOfEmployees":{"@type":"QuantitativeValue","value":25}}]}</script>`;
    expect(extractJsonLd(html)).toMatchObject({ telephone: "+1 512 555 0100", numberOfEmployees: "25" });
  });
  it("strips scripts and keeps block boundaries", () => {
    expect(htmlToText("<p>Hello</p><script>x()</script><div>World &amp; co</div>")).toBe("Hello\nWorld & co");
  });
  it("classifies contact mailbox types", () => {
    expect(contactTypeFor("sales@x.com")).toBe("sales");
    expect(contactTypeFor("info@x.com")).toBe("general");
    expect(contactTypeFor("jane.doe@x.com")).toBe("person");
  });
});
