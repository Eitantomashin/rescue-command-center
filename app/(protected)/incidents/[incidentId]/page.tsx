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
  total_initial_potential: number;
  total_updated_potential: number;
  gap_resolved_count: number;
  resolved_persons: number;
  operational_gap: number;
  total_teams: number;
  active_teams: number;
  available_teams: number;
  active_team_site_assignments: number;
};

type EventLogRow = {
  id: string;
  reported_at: string;
  title: string;
  description: string | null;
  importance: string;
  log_type: string;
  person_id: string | null;
  site_number: number | null;
  operational_number: number | null;
  team_number: number | null;
};

type PersonRow = {
  id: string;
  operational_number: number;
  first_name: string | null;
  last_name: string | null;
};

type ResidentRow = {
  linked_person_id: string | null;
  first_name: string | null;
  last_name: string | null;
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
  fully_cleared_units: number;
  open_units: number;
  open_persons: number;
  gap_resolved_count: number;
  resolved_persons: number;
  operational_gap: number;
};

function personDisplayName(person: Pick<PersonRow | ResidentRow, "first_name" | "last_name">) {
  return [person.first_name, person.last_name].filter(Boolean).join(" ");
}

function operationalPersonLabel(person: PersonRow, linkedResident?: ResidentRow | null) {
  const residentName = linkedResident ? personDisplayName(linkedResident) : "";
  const personName = personDisplayName(person);
  const displayName = residentName || personName;

  return displayName ? `#${person.operational_number} - ${displayName}` : `#${person.operational_number}`;
}

export default async function IncidentDashboardPage({
  params
}: {
  params: { incidentId: string };
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

  const [{ data: recentLogs }, { data: siteRows }] = await Promise.all([
    supabase
      .from("recent_event_logs")
      .select(
        "id,reported_at,title,description,importance,log_type,person_id,site_number,operational_number,team_number"
      )
      .eq("incident_id", params.incidentId)
      .order("reported_at", { ascending: false })
      .limit(8),
    supabase
      .from("site_dashboard_summary")
      .select("*")
      .eq("incident_id", params.incidentId)
      .order("site_number", { ascending: true })
      .limit(6)
  ]);

  const logs = (recentLogs ?? []) as EventLogRow[];
  const sites = (siteRows ?? []) as SiteSummaryRow[];
  const logPersonIds = Array.from(
    new Set(logs.map((log) => log.person_id).filter(Boolean) as string[])
  );
  const [{ data: logPersonRows }, { data: linkedResidentRows }] =
    logPersonIds.length > 0
      ? await Promise.all([
          supabase
            .from("persons")
            .select("id,operational_number,first_name,last_name")
            .in("id", logPersonIds),
          supabase
            .from("unit_residents")
            .select("linked_person_id,first_name,last_name")
            .in("linked_person_id", logPersonIds)
        ])
      : [{ data: [] }, { data: [] }];
  const personsById = new Map(((logPersonRows ?? []) as PersonRow[]).map((person) => [person.id, person]));
  const residentsByPerson = new Map(
    ((linkedResidentRows ?? []) as ResidentRow[])
      .filter((resident) => resident.linked_person_id)
      .map((resident) => [resident.linked_person_id as string, resident])
  );

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>{summary.name}</h1>
          <p className="muted">
            {summary.city ?? "-"} · {summary.address} · נפתח{" "}
            {formatDateTime(summary.opened_at)}
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
          <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites`}>
            אתרים
          </Link>
        </div>
      </div>

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
                    {formatNumber(site.initial_potential)} /{" "}
                    {formatNumber(site.updated_potential)}
                  </td>
                  <td>
                    {formatNumber(site.open_units)} מתוך{" "}
                    {formatNumber(site.total_active_units)}
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

      <section className="panel section-spaced">
        <h2>פעילות אחרונה</h2>
        {logs.length === 0 ? (
          <p className="muted">אין עדיין אירועים ביומן.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>זמן</th>
                <th>אירוע</th>
                <th>קישורים</th>
                <th>חשיבות</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const person = log.person_id ? personsById.get(log.person_id) : null;
                const linkedResident = log.person_id ? residentsByPerson.get(log.person_id) : null;
                const personLabel = person
                  ? operationalPersonLabel(person, linkedResident)
                  : log.operational_number
                    ? `#${log.operational_number}`
                    : null;

                return (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.reported_at)}</td>
                    <td>
                      <strong>{log.title}</strong>
                      <div className="muted">{log.log_type}</div>
                      {log.description ? <div className="muted">{log.description}</div> : null}
                    </td>
                    <td>
                      {log.site_number ? <div>אתר {log.site_number}</div> : null}
                      {personLabel ? <div>{personLabel}</div> : null}
                      {log.team_number ? <div>צוות {log.team_number}</div> : null}
                      {!log.site_number && !personLabel && !log.team_number ? "-" : null}
                    </td>
                    <td>{log.importance}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
