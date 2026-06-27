export type SiteType = "rescue_site" | "search_site";

export function isSearchSite(site: { site_type?: string | null }) {
  return site.site_type === "search_site";
}

export function siteTypeLabel(siteType?: string | null) {
  return siteType === "search_site" ? "אתר סריקה" : "אתר חילוץ";
}

export function searchStatusLabel(searchStatus?: string | null) {
  switch (searchStatus) {
    case "not_started":
      return "טרם התחיל";
    case "in_progress":
      return "בסריקה";
    case "has_open_items":
      return "ממצאים פתוחים";
    case "cleared":
      return "אתר מזוכה";
    default:
      return "טרם התחיל";
  }
}
