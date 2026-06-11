import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/format";

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
  resolved_persons: number;
  operational_gap: number;
};

export default async function SitesPage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();

  const { data: incident } = await supabase
    .from("incidents")
    .select("id,name")
    .eq("id", params.incidentId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("site_dashboard_summary")
    .select("*")
    .eq("incident_id", params.incidentId)
    .order("site_number", { ascending: true });

  const sites = (data ?? []) as SiteRow[];

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>אתרים</h1>
          <p className="muted">{incident?.name ?? "אירוע"}</p>
        </div>

        <Link className="button secondary" href={`/incidents/${params.incidentId}`}>
          חזרה לדשבורד
        </Link>
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
                <th>סטטוס</th>
                <th>פוטנציאל</th>
                <th>יחידות פתוחות</th>
                <th>זיכוי מלא</th>
                <th>פער</th>
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
                  <td>{formatNumber(site.operational_gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
