// Industry taxonomy. Each leaf maps to OpenStreetMap tags (used by the discovery
// provider) and a plain-language search term (used by text-search fallbacks).
// The taxonomy is generic on purpose — it is not tied to any client's offering.

export interface IndustryLeaf {
  key: string;
  label: string;
  /** OSM tag filters, e.g. [["amenity", "restaurant"]]. */
  osm: [string, string][];
  term: string;
}

export interface IndustryGroup {
  key: string;
  label: string;
  children: IndustryLeaf[];
}

const leaf = (key: string, label: string, osm: [string, string][], term = label.toLowerCase()): IndustryLeaf => ({
  key,
  label,
  osm,
  term,
});

export const INDUSTRIES: IndustryGroup[] = [
  {
    key: "food",
    label: "Food & Beverage",
    children: [
      leaf("food.restaurant", "Restaurants", [["amenity", "restaurant"]], "restaurant"),
      leaf("food.cafe", "Cafés & Coffee", [["amenity", "cafe"]], "cafe"),
      leaf("food.bar", "Bars & Pubs", [["amenity", "bar"], ["amenity", "pub"]], "bar"),
      leaf("food.fast_food", "Quick Service", [["amenity", "fast_food"]], "fast food"),
      leaf("food.bakery", "Bakeries", [["shop", "bakery"]], "bakery"),
      leaf("food.brewery", "Breweries & Wineries", [["craft", "brewery"], ["craft", "winery"]], "brewery"),
    ],
  },
  {
    key: "retail",
    label: "Retail",
    children: [
      leaf("retail.grocery", "Grocery & Supermarkets", [["shop", "supermarket"], ["shop", "convenience"]], "supermarket"),
      leaf("retail.apparel", "Apparel & Fashion", [["shop", "clothes"], ["shop", "shoes"]], "clothing store"),
      leaf("retail.electronics", "Electronics", [["shop", "electronics"], ["shop", "computer"], ["shop", "mobile_phone"]], "electronics store"),
      leaf("retail.home", "Home & Furniture", [["shop", "furniture"], ["shop", "interior_decoration"], ["shop", "doityourself"], ["shop", "hardware"]], "furniture store"),
      leaf("retail.specialty", "Specialty Retail", [["shop", "books"], ["shop", "gift"], ["shop", "jewelry"], ["shop", "sports"], ["shop", "florist"]], "shop"),
    ],
  },
  {
    key: "health",
    label: "Healthcare",
    children: [
      leaf("health.clinic", "Clinics & Practices", [["amenity", "clinic"], ["amenity", "doctors"], ["healthcare", "clinic"]], "clinic"),
      leaf("health.dental", "Dental", [["amenity", "dentist"], ["healthcare", "dentist"]], "dentist"),
      leaf("health.pharmacy", "Pharmacies", [["amenity", "pharmacy"]], "pharmacy"),
      leaf("health.therapy", "Therapy & Wellness", [["healthcare", "physiotherapist"], ["healthcare", "psychotherapist"], ["healthcare", "alternative"]], "physiotherapy"),
      leaf("health.veterinary", "Veterinary", [["amenity", "veterinary"]], "veterinary"),
    ],
  },
  {
    key: "professional",
    label: "Professional Services",
    children: [
      leaf("professional.legal", "Legal", [["office", "lawyer"], ["office", "notary"]], "law firm"),
      leaf("professional.accounting", "Accounting & Tax", [["office", "accountant"], ["office", "tax_advisor"]], "accountant"),
      leaf("professional.consulting", "Consulting", [["office", "consulting"]], "consulting firm"),
      leaf("professional.marketing", "Marketing & Advertising", [["office", "advertising_agency"]], "marketing agency"),
      leaf("professional.architecture", "Architecture & Engineering", [["office", "architect"], ["office", "engineer"]], "architect"),
      leaf("professional.staffing", "Staffing & Recruiting", [["office", "employment_agency"]], "staffing agency"),
    ],
  },
  {
    key: "technology",
    label: "Technology",
    children: [
      leaf("technology.software", "Software & IT Services", [["office", "it"]], "software company"),
      leaf("technology.telecom", "Telecommunications", [["office", "telecommunication"]], "telecommunications"),
      leaf("technology.research", "Research & Development", [["office", "research"]], "research company"),
    ],
  },
  {
    key: "finance",
    label: "Finance & Insurance",
    children: [
      leaf("finance.banking", "Banking", [["amenity", "bank"]], "bank"),
      leaf("finance.financial", "Financial Advisory", [["office", "financial"], ["office", "financial_advisor"]], "financial advisor"),
      leaf("finance.insurance", "Insurance", [["office", "insurance"]], "insurance agency"),
    ],
  },
  {
    key: "realestate",
    label: "Real Estate",
    children: [
      leaf("realestate.agency", "Real Estate Agencies", [["office", "estate_agent"]], "real estate agency"),
      leaf("realestate.property", "Property Management", [["office", "property_management"]], "property management"),
    ],
  },
  {
    key: "trades",
    label: "Construction & Trades",
    children: [
      leaf("trades.construction", "Construction", [["office", "construction_company"], ["craft", "builder"]], "construction company"),
      leaf("trades.electrical", "Electrical", [["craft", "electrician"]], "electrician"),
      leaf("trades.plumbing", "Plumbing & HVAC", [["craft", "plumber"], ["craft", "hvac"]], "plumber"),
      leaf("trades.carpentry", "Carpentry & Joinery", [["craft", "carpenter"], ["craft", "joiner"]], "carpenter"),
      leaf("trades.roofing", "Roofing", [["craft", "roofer"]], "roofing"),
    ],
  },
  {
    key: "industrial",
    label: "Manufacturing & Industrial",
    children: [
      leaf("industrial.manufacturing", "Manufacturing", [["man_made", "works"], ["industrial", "factory"]], "manufacturer"),
      leaf("industrial.metal", "Metalwork", [["craft", "metal_construction"], ["craft", "welder"]], "metal fabrication"),
      leaf("industrial.printing", "Printing", [["craft", "printer"], ["shop", "copyshop"]], "printing company"),
      leaf("industrial.logistics", "Logistics & Warehousing", [["office", "logistics"], ["industrial", "warehouse"]], "logistics company"),
    ],
  },
  {
    key: "automotive",
    label: "Automotive",
    children: [
      leaf("automotive.dealers", "Dealerships", [["shop", "car"]], "car dealership"),
      leaf("automotive.repair", "Repair & Service", [["shop", "car_repair"], ["shop", "tyres"]], "car repair"),
      leaf("automotive.parts", "Parts", [["shop", "car_parts"]], "auto parts"),
    ],
  },
  {
    key: "hospitality",
    label: "Hospitality & Travel",
    children: [
      leaf("hospitality.lodging", "Hotels & Lodging", [["tourism", "hotel"], ["tourism", "motel"], ["tourism", "guest_house"]], "hotel"),
      leaf("hospitality.travel", "Travel Agencies", [["shop", "travel_agency"], ["office", "travel_agent"]], "travel agency"),
      leaf("hospitality.events", "Event Venues", [["amenity", "events_venue"], ["amenity", "conference_centre"]], "event venue"),
    ],
  },
  {
    key: "personal",
    label: "Personal Services",
    children: [
      leaf("personal.beauty", "Hair & Beauty", [["shop", "hairdresser"], ["shop", "beauty"]], "salon"),
      leaf("personal.fitness", "Fitness", [["leisure", "fitness_centre"], ["leisure", "sports_centre"]], "gym"),
      leaf("personal.cleaning", "Laundry & Cleaning", [["shop", "laundry"], ["shop", "dry_cleaning"]], "dry cleaning"),
    ],
  },
  {
    key: "education",
    label: "Education & Training",
    children: [
      leaf("education.schools", "Private Schools & Tutoring", [["amenity", "language_school"], ["amenity", "music_school"], ["amenity", "driving_school"]], "tutoring"),
      leaf("education.training", "Training Providers", [["office", "educational_institution"]], "training center"),
      leaf("education.childcare", "Childcare", [["amenity", "childcare"], ["amenity", "kindergarten"]], "childcare"),
    ],
  },
  {
    key: "nonprofit",
    label: "Nonprofit & Associations",
    children: [
      leaf("nonprofit.ngo", "Nonprofits", [["office", "ngo"], ["office", "charity"]], "nonprofit"),
      leaf("nonprofit.association", "Associations", [["office", "association"]], "association"),
    ],
  },
];

export const INDUSTRY_LEAVES: IndustryLeaf[] = INDUSTRIES.flatMap((g) => g.children);

const leafIndex = new Map(INDUSTRY_LEAVES.map((l) => [l.key, l]));
const groupIndex = new Map(INDUSTRIES.map((g) => [g.key, g]));

/** Expand a selection of group and/or leaf keys into a de-duplicated list of leaves. */
export function expandIndustries(keys: string[]): IndustryLeaf[] {
  if (keys.length === 0) return INDUSTRY_LEAVES;
  const out = new Map<string, IndustryLeaf>();
  for (const key of keys) {
    const group = groupIndex.get(key);
    if (group) group.children.forEach((c) => out.set(c.key, c));
    const l = leafIndex.get(key);
    if (l) out.set(l.key, l);
  }
  return [...out.values()];
}

export function industryLabel(key: string | null | undefined): string {
  if (!key) return "Uncategorized";
  return leafIndex.get(key)?.label ?? groupIndex.get(key)?.label ?? key;
}

export function industryGroupOf(key: string | null | undefined): IndustryGroup | undefined {
  if (!key) return undefined;
  return groupIndex.get(key.split(".")[0]);
}

/** Map an OSM tag set to the most specific matching industry leaf. */
export function classifyOsmTags(tags: Record<string, string>): IndustryLeaf | null {
  for (const l of INDUSTRY_LEAVES) {
    if (l.osm.some(([k, v]) => tags[k] === v)) return l;
  }
  return null;
}
