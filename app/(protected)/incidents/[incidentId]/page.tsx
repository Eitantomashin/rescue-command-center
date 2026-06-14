import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";

type DashboardRow = {
  incident_id: string;
  name: string;
  city: string | null;
  address: string;
  opened_at: string;
  ended_at: string | null;
  is_closed: boolean;
  incident_status_label: string | null;
  total_sites: number;
  initial_potential: number;
  updated_potential: number;
  gap_resolved_count: number;
  operational_gap: number;
  active_teams: number;
  available_teams: number;
  active_team_site_assignments: number;
};

type SiteSummaryRow = {
  site_id: string;
  site_number: number;
  name: string | null;
  street: string;
  house_number: string;
  site_status_label: string | null;
  initial_potential: number;
  updated_potential: number;
  total_active_units: number;
  open_units: number;
  gap_resolved_count: number;
  operational_gap: number;
};

export default async function IncidentDashboardPage({
  params,
  searchParams
}: {
  params: { incidentId: string };
  searchParams?: { created?: string };
}) {
  const supabase = createClient();
  const { data: dashboard, error } = await supabase
    .from("incident_dashboard_summary")
    .select("*")
    .eq("incident_id", params.incidentId)
    .maybeSingle();

  if (error || !dashboard) {
    notFound();
  }

  const summary = dashboard as DashboardRow;

  const { data: siteRows } = await supabase
    .from("site_dashboard_summary")
    .select("*")
    .eq("incident_id", params.incidentId)
    .order("site_number", { ascending: true })
    .limit(6);

  const sites = (siteRows ?? []) as SiteSummaryRow[];
  const siteWizardHref = `/incidents/${summary.incident_id}/sites/new`;

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>{summary.name}</h1>
          <p className="muted">
            {summary.city ?? "-"} · {summary.address} · נפתח {formatDateTime(summary.opened_at)}
          </p>
          <p className="muted">
            סטטוס: {summary.incident_status_label ?? (summary.is_closed ? "סגור" : "פעיל")}
            {summary.ended_at ? ` · נסגר ${formatDateTime(summary.ended_at)}` : ""}
          </p>
        </div>

        <div className="actions">
          <Link className="button secondary" href="/incidents">
            חזרה לאירועים
          </Link>
          <Link className="button secondary" href="/incidents/new">
            פתיחת אירוע חדש
          </Link>
          <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites`}>
            אתרים
          </Link>
          <Link className="button" href={`/incidents/${summary.incident_id}/operational-log`}>
            יומן מבצעי
          </Link>
        </div>
      </div>

      {searchParams?.created === "1" ? (
        <section className="panel success-panel">
          <div>
            <h2>האירוע נפתח בהצלחה</h2>
            <p className="muted">השלב המבצעי הבא הוא הקמת האתר הראשון באירוע.</p>
          </div>
          <Link className="button" href={siteWizardHref}>
            הקם אתר ראשון
          </Link>
        </section>
      ) : null}

      <section className="grid" aria-label="מדדי אירוע">
        <div className="metric">
          אתרים
          <strong>{formatNumber(summary.total_sites)}</strong>
        </div>
        <div className="metric">
          פוטנציאל ראשוני
          <strong>{formatNumber(summary.initial_potential)}</strong>
        </div>
        <div className="metric">
          פוטנציאל מעודכן
          <strong>{formatNumber(summary.updated_potential)}</strong>
        </div>
        <div className="metric">
          טופלו / ידועים
          <strong>{formatNumber(summary.gap_resolved_count)}</strong>
        </div>
        <div className="metric metric-emphasis">
          פער מבצעי
          <strong>{formatNumber(summary.operational_gap)}</strong>
        </div>
        <div className="metric">
          צוותים פעילים
          <strong>{formatNumber(summary.active_teams)}</strong>
        </div>
        <div className="metric">
          צוותים זמינים
          <strong>{formatNumber(summary.available_teams)}</strong>
        </div>
        <div className="metric">
          שיוכי צוותים פעילים
          <strong>{formatNumber(summary.active_team_site_assignments)}</strong>
        </div>
      </section>

      {summary.total_sites === 0 ? (
        <section className="panel section-spaced next-action-panel">
          <div>
            <h2>צור אתר ראשון</h2>
            <p className="muted">האתר הוא המקום שבו מגדירים מבנה, דירות, אזורים וצוותים.</p>
          </div>
          <Link className="button" href={siteWizardHref}>
            צור אתר ראשון
          </Link>
        </section>
      ) : null}

      <section className="panel section-spaced">
        <div className="header compact">
          <div>
            <h2>אתרים מקושרים</h2>
            <p className="muted">תמונת מצב מחושבת לכל אתר באירוע</p>
          </div>
          <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites`}>
            כל האתרים
          </Link>
        </div>

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
                  </td>
                  <td>{site.site_status_label ?? "-"}</td>
                  <td>
                    {formatNumber(site.initial_potential)} / {formatNumber(site.updated_potential)}
                  </td>
                  <td>
                    {formatNumber(site.open_units)} מתוך {formatNumber(site.total_active_units)}
                  </td>
                  <td>{formatNumber(site.gap_resolved_count)}</td>
                  <td className="table-emphasis">{formatNumber(site.operational_gap)}</td>
                  <td>
                    <Link
                      className="button secondary"
                      href={`/incidents/${summary.incident_id}/sites/${site.site_id}`}
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
