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
  total_initial_potential: number;
  total_updated_potential: number;
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
};

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

  const { data: recentLogs } = await supabase
    .from("recent_event_logs")
    .select("id,reported_at,title,description,importance")
    .eq("incident_id", params.incidentId)
    .limit(8);

  const logs = (recentLogs ?? []) as EventLogRow[];

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>{summary.name}</h1>
          <p className="muted">
            {summary.city ?? "-"} · {summary.address} · נפתח{" "}
            {formatDateTime(summary.opened_at)}
          </p>
        </div>

        <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites`}>
          אתרים
        </Link>
      </div>

      <section className="grid" aria-label="מדדי אירוע">
        <div className="metric">
          אתרים
          <strong>{formatNumber(summary.total_sites)}</strong>
        </div>
        <div className="metric">
          פוטנציאל ראשוני
          <strong>{formatNumber(summary.total_initial_potential)}</strong>
        </div>
        <div className="metric">
          פוטנציאל מעודכן
          <strong>{formatNumber(summary.total_updated_potential)}</strong>
        </div>
        <div className="metric">
          פער מבצעי
          <strong>{formatNumber(summary.operational_gap)}</strong>
        </div>
        <div className="metric">
          מחולצים / פתורים
          <strong>{formatNumber(summary.resolved_persons)}</strong>
        </div>
        <div className="metric">
          צוותים פעילים
          <strong>{formatNumber(summary.active_teams)}</strong>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>פעילות אחרונה</h2>
        {logs.length === 0 ? (
          <p className="muted">אין עדיין אירועים ביומן.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>זמן</th>
                <th>כותרת</th>
                <th>חשיבות</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.reported_at)}</td>
                  <td>
                    <strong>{log.title}</strong>
                    {log.description ? <div className="muted">{log.description}</div> : null}
                  </td>
                  <td>{log.importance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
