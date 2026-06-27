import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/format";
import { isSearchSite, searchStatusLabel, siteTypeLabel } from "@/lib/site-display";

type SiteRow = {
  incident_id: string;
  site_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string;
  house_number: string;
  site_status_label: string | null;
  initial_potential: number;
  updated_potential: number;
  total_active_units: number;
  fully_cleared_units: number;
  open_units: number;
  open_persons: number;
  gap_resolved_count: number;
  resolved_persons: number;
  operational_gap: number;
  site_type?: string | null;
  search_status?: string | null;
};

export default async function SitesPage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();

  const [{ data: incident }, { data, error }, { data: siteMetadataRows }, { data: canManageSites }] = await Promise.all([
    supabase.from("incidents").select("id,name").eq("id", params.incidentId).maybeSingle(),
    supabase.from("site_dashboard_summary").select("*").eq("incident_id", params.incidentId).order("site_number", { ascending: true }),
    supabase.from("sites").select("id,site_type,search_status").eq("incident_id", params.incidentId).eq("is_active", true),
    supabase.rpc("can_manage_sites", { p_incident_id: params.incidentId })
  ]);

  const siteMetadata = new Map(
    ((siteMetadataRows ?? []) as Array<{ id: string; site_type: string | null; search_status: string | null }>).map((site) => [site.id, site])
  );
  const sites = ((data ?? []) as SiteRow[]).map((site) => ({
    ...site,
    site_type: siteMetadata.get(site.site_id)?.site_type ?? "rescue_site",
    search_status: siteMetadata.get(site.site_id)?.search_status ?? null
  }));

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>אתרים</h1>
          <p className="muted">{incident?.name ?? "אירוע"}</p>
        </div>

        <div className="actions">
          {canManageSites ? (
          <Link className="button" href={`/incidents/${params.incidentId}/sites/new`}>
            הקמת אתר חדש
          </Link>
          ) : null}
          <Link className="button secondary" href={`/incidents/${params.incidentId}`}>
            חזרה לדשבורד
          </Link>
        </div>
      </div>

      {error ? (
        <section className="panel">
          <p className="error">לא ניתן לטעון אתרים: {error.message}</p>
        </section>
      ) : null}

      <section className="panel">
        {sites.length === 0 ? (
          <p className="muted">לא נמצאו אתרים לאירוע זה.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>אתר</th>
                <th>כתובת</th>
                <th className="site-type-header">{"\u05e1\u05d5\u05d2 \u05d0\u05ea\u05e8"}</th>
                <th>סטטוס</th>
                <th>פוטנציאל</th>
                <th>יחידות פתוחות</th>
                <th>זיכוי מלא</th>
                <th>טופלו / ידועים</th>
                <th>פער</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.site_id}>
                  <td>
                    אתר {site.site_number}
                    {site.name ? <div className="muted">{site.name}</div> : null}
                  </td>
                  <td>
                    {site.street} {site.house_number}
                    {site.city ? <div className="muted">{site.city}</div> : null}
                  </td>
                  <td className="site-type-column">
                    <span className={`site-type-badge ${isSearchSite(site) ? "search-site" : "rescue-site"}`}>
                      {siteTypeLabel(site.site_type)}
                    </span>
                    {isSearchSite(site) ? <div className="muted search-status-inline">{searchStatusLabel(site.search_status)}</div> : null}
                  </td>
                  <td>{site.site_status_label ?? "-"}</td>
                  <td>
                    {formatNumber(site.initial_potential)} /{" "}
                    {formatNumber(site.updated_potential)}
                  </td>
                  <td>{formatNumber(site.open_units)}</td>
                  <td>
                    {formatNumber(site.fully_cleared_units)} /{" "}
                    {formatNumber(site.total_active_units)}
                  </td>
                  <td>{formatNumber(site.gap_resolved_count)}</td>
                  <td className="table-emphasis">{formatNumber(site.operational_gap)}</td>
                  <td>
                    <Link
                      className="button secondary"
                      href={`/incidents/${params.incidentId}/sites/${site.site_id}`}
                    >
                      פתיחת תמונת מבנה
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
