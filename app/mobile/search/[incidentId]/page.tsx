import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { searchLiveStatus } from "@/lib/search-site-status";
import { createClient } from "@/lib/supabase/server";

type IncidentRow = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  lifecycle_status: string | null;
  archived_at: string | null;
};

type SearchSiteRow = {
  id: string;
  incident_id: string;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  search_status: string | null;
};

type SearchUnitRow = {
  id: string;
  site_id: string;
  is_active: boolean;
};

type SearchResultRow = {
  site_id: string;
  unit_id: string;
  search_status: string | null;
};

type SearchSiteLiveSummary = {
  totalUnits: number;
  scanned: number;
  noAnswer: number;
  casualties: number;
  completed: number;
};

function siteName(site: SearchSiteRow) {
  return site.name?.trim() || [site.street, site.house_number].filter(Boolean).join(" ").trim() || "אתר סריקה";
}

function siteAddress(site: SearchSiteRow) {
  return [site.street, site.house_number, site.city].filter(Boolean).join(" ").trim();
}

function userDisplayName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  const metadata = user.user_metadata ?? {};
  const displayName = String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? "").trim();
  return displayName || user.email || "משתמש סריקה";
}

function emptyLiveSummary(): SearchSiteLiveSummary {
  return {
    totalUnits: 0,
    scanned: 0,
    noAnswer: 0,
    casualties: 0,
    completed: 0
  };
}

function progressPercent(summary: SearchSiteLiveSummary) {
  return summary.totalUnits > 0 ? Math.round((summary.scanned / summary.totalUnits) * 100) : 0;
}

export default async function MobileSearchSitesPage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [
    { data: incident, error: incidentError },
    { data: sites, error: sitesError },
    { data: unitRows },
    { data: searchRows }
  ] = await Promise.all([
    supabase
      .from("incidents")
      .select("id,name,city,address,lifecycle_status,archived_at")
      .eq("id", params.incidentId)
      .maybeSingle(),
    supabase
      .from("sites")
      .select("id,incident_id,name,city,street,house_number,search_status")
      .eq("incident_id", params.incidentId)
      .eq("site_type", "search_site")
      .eq("is_active", true)
      .order("site_number", { ascending: true }),
    supabase
      .from("units")
      .select("id,site_id,is_active")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true),
    supabase
      .from("site_search_units")
      .select("site_id,unit_id,search_status")
      .eq("incident_id", params.incidentId)
  ]);

  if (incidentError || !incident) {
    notFound();
  }

  const incidentRow = incident as IncidentRow;
  if (incidentRow.archived_at || incidentRow.lifecycle_status === "closed") {
    notFound();
  }

  const searchSites = (sites ?? []) as SearchSiteRow[];
  const resultsByUnit = new Map(((searchRows ?? []) as SearchResultRow[]).map((row) => [row.unit_id, row]));
  const summariesBySite = ((unitRows ?? []) as SearchUnitRow[]).reduce<Map<string, SearchSiteLiveSummary>>((map, unit) => {
    const summary = map.get(unit.site_id) ?? emptyLiveSummary();
    const status = resultsByUnit.get(unit.id)?.search_status ?? "not_visited";

    summary.totalUnits += 1;
    if (["clear", "no_answer", "casualties", "completed"].includes(status)) summary.scanned += 1;
    if (status === "completed") summary.completed += 1;
    if (status === "no_answer") summary.noAnswer += 1;
    if (status === "casualties") summary.casualties += 1;

    map.set(unit.site_id, summary);
    return map;
  }, new Map());

  return (
    <main className="mobile-search-app" dir="rtl">
      <header className="mobile-search-topbar">
        <Link className="button compact secondary" href="/mobile/search">חזרה</Link>
        <div>
          <span>אירוע</span>
          <strong>{incidentRow.name}</strong>
        </div>
        <div className="mobile-search-user">
          <span>מדווח:</span>
          <strong>{userDisplayName(user)}</strong>
        </div>
      </header>

      {sitesError ? <p className="error">{sitesError.message}</p> : null}

      <section className="mobile-search-card-list" aria-label="אתרי סריקה">
        {searchSites.length === 0 ? (
          <div className="empty-state">
            <h1>אין אתרי סריקה באירוע</h1>
            <p className="muted">אתרי חילוץ אינם מוצגים במסלול הסריקה.</p>
          </div>
        ) : null}

        {searchSites.map((site) => {
          const summary = summariesBySite.get(site.id) ?? emptyLiveSummary();
          const status = searchLiveStatus({
            total_units: summary.totalUnits,
            clear_count: summary.scanned - summary.noAnswer - summary.casualties - summary.completed,
            completed_count: summary.completed,
            no_answer_count: summary.noAnswer,
            casualties_count: summary.casualties,
            not_visited_count: Math.max(0, summary.totalUnits - summary.scanned)
          });
          const percent = progressPercent(summary);

          return (
            <Link className={`mobile-search-selection-card site-card search-site-live-${status.tone}`} href={`/mobile/search/${params.incidentId}/${site.id}`} key={site.id}>
              <span className="mobile-search-eyebrow">אתר סריקה</span>
              <strong>{siteName(site)}</strong>
              {siteAddress(site) ? <small>{siteAddress(site)}</small> : null}
              <div className="mobile-search-site-progress">
                <em>{status.label}</em>
                <span>{formatPercent(percent)} הושלם</span>
              </div>
              <div className="mobile-search-mini-progress" aria-hidden="true">
                <span style={{ inlineSize: `${percent}%` }} />
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}

function formatPercent(value: number) {
  return `${value}%`;
}
