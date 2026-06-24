import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { archiveIncident, permanentlyDeleteIncident, restoreIncident } from "./actions";

type IncidentRow = {
  id: string;
  name: string;
  city: string | null;
  address: string;
  opened_at: string;
  ended_at: string | null;
  status_id: string;
  is_closed: boolean;
  lifecycle_status: "active" | "paused" | "closed";
  archived_at: string | null;
  archived_by: string | null;
};

const text = {
  title: "\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd",
  subtitle: "\u05ea\u05de\u05d5\u05e0\u05ea \u05e4\u05ea\u05d9\u05d7\u05d4 \u05dc\u05db\u05dc \u05d0\u05d9\u05e8\u05d5\u05e2\u05d9 \u05d4\u05d7\u05d9\u05dc\u05d5\u05e5",
  newIncident: "\u05e4\u05ea\u05d9\u05d7\u05ea \u05d0\u05d9\u05e8\u05d5\u05e2 \u05d7\u05d3\u05e9",
  activeIncidents: "\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd",
  archivedIncidents: "\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05d1\u05d0\u05e8\u05db\u05d9\u05d5\u05df",
  noIncidents: "\u05d0\u05d9\u05df \u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05dc\u05d4\u05e6\u05d2\u05d4",
  incidentName: "\u05e9\u05dd \u05d0\u05d9\u05e8\u05d5\u05e2",
  city: "\u05e2\u05d9\u05e8",
  address: "\u05db\u05ea\u05d5\u05d1\u05ea",
  status: "\u05e1\u05d8\u05d8\u05d5\u05e1",
  openedAt: "\u05e0\u05e4\u05ea\u05d7",
  archivedAt: "\u05d0\u05d5\u05e8\u05db\u05d1",
  open: "\u05e4\u05ea\u05d9\u05d7\u05d4",
  active: "\u05e4\u05e2\u05d9\u05dc",
  closed: "\u05e1\u05d2\u05d5\u05e8",
  archive: "\u05d4\u05e2\u05d1\u05e8 \u05dc\u05d0\u05e8\u05db\u05d9\u05d5\u05df",
  restore: "\u05e9\u05d7\u05d6\u05d5\u05e8 \u05de\u05d0\u05e8\u05db\u05d9\u05d5\u05df",
  paused: "מושהה",
  permanentDelete: "מחיקה לצמיתות",
  permanentDeleteWarning: "פעולה זו תמחק את האירוע לצמיתות ולא ניתן יהיה לשחזר.",
  archiveConfirm: "\u05dc\u05d0\u05d9\u05e9\u05d5\u05e8 \u05d4\u05e2\u05d1\u05e8\u05d4 \u05dc\u05d0\u05e8\u05db\u05d9\u05d5\u05df, \u05d4\u05e7\u05dc\u05d3 \u05d0\u05ea \u05e9\u05dd \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2 \u05d1\u05de\u05d3\u05d5\u05d9\u05e7.",
  confirmPlaceholder: "\u05d4\u05e7\u05dc\u05d3 \u05e9\u05dd \u05d0\u05d9\u05e8\u05d5\u05e2"
};

function lifecycleLabel(incident: IncidentRow) {
  if (incident.lifecycle_status === "closed" || incident.is_closed) return text.closed;
  if (incident.lifecycle_status === "paused") return text.paused;
  return text.active;
}

export default async function IncidentsPage({
  searchParams
}: {
  searchParams?: { view?: string };
}) {
  const supabase = createClient();
  const { data: systemRole } = await supabase.rpc("current_user_role");
  const isAdmin = systemRole === "admin";
  const canManageIncidents = isAdmin || systemRole === "commander";
  const canViewAssignedArchive = isAdmin || systemRole === "commander";
  const archiveView = canViewAssignedArchive && searchParams?.view === "archived";

  let query = supabase
    .from("incidents")
    .select("id,name,city,address,opened_at,ended_at,status_id,is_closed,lifecycle_status,archived_at,archived_by")
    .order("opened_at", { ascending: false });

  query = archiveView ? query.not("archived_at", "is", null) : query.is("archived_at", null);

  const { data, error } = await query;
  const incidents = (data ?? []) as IncidentRow[];

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>{text.title}</h1>
          <p className="muted">{text.subtitle}</p>
        </div>
        <div className="actions">
          {canViewAssignedArchive ? (
            <div className="admin-archive-tabs">
              <Link className={archiveView ? "button secondary" : "button"} href="/incidents">
                {text.activeIncidents}
              </Link>
              <Link className={archiveView ? "button" : "button secondary"} href="/incidents?view=archived">
                {text.archivedIncidents}
              </Link>
            </div>
          ) : null}
          {canManageIncidents ? (
            <Link className="button" href="/incidents/new">
              {text.newIncident}
            </Link>
          ) : null}
        </div>
      </div>

      {error ? (
        <section className="panel">
          <p className="error">{error.message}</p>
        </section>
      ) : null}

      <section className="panel">
        {incidents.length === 0 ? (
          <div className="empty-state">
            <h2>{text.noIncidents}</h2>
            {!archiveView && canManageIncidents ? <Link className="button" href="/incidents/new">{text.newIncident}</Link> : null}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{text.incidentName}</th>
                <th>{text.city}</th>
                <th>{text.address}</th>
                <th>{text.status}</th>
                <th>{archiveView ? text.archivedAt : text.openedAt}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td>
                    <strong>{incident.name}</strong>
                  </td>
                  <td>{incident.city ?? "-"}</td>
                  <td>{incident.address}</td>
                  <td>
                    <span className={`command-badge ${incident.is_closed ? "coverage-low" : "coverage-medium"}`}>
                      {lifecycleLabel(incident)}
                    </span>
                    <div className="muted">{incident.status_id}</div>
                  </td>
                  <td>{formatDateTime(archiveView ? incident.archived_at ?? incident.opened_at : incident.opened_at)}</td>
                  <td>
                    <div className="incident-row-actions">
                      <Link className="button secondary" href={`/incidents/${incident.id}`}>
                        {text.open}
                      </Link>
                      {isAdmin && !archiveView ? (
                        <details className="archive-confirm-panel">
                          <summary className="button danger">{text.archive}</summary>
                          <form action={archiveIncident} className="action-form">
                            <input type="hidden" name="incidentId" value={incident.id} />
                            <input type="hidden" name="incidentName" value={incident.name} />
                            <strong>{incident.name}</strong>
                            <p className="muted">{text.archiveConfirm}</p>
                            <input className="input" name="confirmationName" placeholder={text.confirmPlaceholder} required />
                            <button className="button danger" type="submit">
                              {text.archive}
                            </button>
                          </form>
                        </details>
                      ) : null}
                      {isAdmin && archiveView ? (
                        <>
                          <form action={restoreIncident}>
                            <input type="hidden" name="incidentId" value={incident.id} />
                            <button className="button secondary" type="submit">
                              {text.restore}
                            </button>
                          </form>
                          <details className="archive-confirm-panel">
                            <summary className="button danger">{text.permanentDelete}</summary>
                            <form action={permanentlyDeleteIncident} className="action-form">
                              <input type="hidden" name="incidentId" value={incident.id} />
                              <input type="hidden" name="incidentName" value={incident.name} />
                              <strong>{incident.name}</strong>
                              <p className="error">{text.permanentDeleteWarning}</p>
                              <p className="muted">{text.archiveConfirm}</p>
                              <input className="input" name="confirmationName" placeholder={text.confirmPlaceholder} required />
                              <button className="button danger" type="submit">
                                {text.permanentDelete}
                              </button>
                            </form>
                          </details>
                        </>
                      ) : null}
                    </div>
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
