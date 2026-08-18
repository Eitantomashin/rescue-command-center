import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getVehicleRosterForIncident, listVehicleRostersForIncident } from "../../actions";
import { VehicleRosterPrintButton } from "../print-button";
import {
  ROSTER_REPORT_STATUSES,
  commanderNames,
  driverNames,
  formatPrintDateTime,
  movementLabel,
  parseReportMode,
  parseStatusFilter,
  participantKey,
  participantRoles,
  reportModeLabel,
  rosterKindLabel,
  rosterRelationshipText,
  rosterSort,
  sourceText,
  statusFilterLabel,
  statusLabel,
  text,
  uniqueParticipantCount,
  type RosterPrintIncident
} from "../print-utils";
import { numberValue, type RosterStatus, type VehicleRosterDetail, type VehicleRosterListRow } from "../roster-types";

type SearchParams = {
  statuses?: string | string[];
  mode?: string | string[];
};

export default async function VehicleRosterCentralReportPage({
  params,
  searchParams
}: {
  params: { incidentId: string };
  searchParams?: SearchParams;
}) {
  const supabase = createClient();
  const generatedAt = new Date().toISOString();
  const selectedStatuses = parseStatusFilter(searchParams?.statuses);
  const mode = parseReportMode(searchParams?.mode);
  const [{ data: incident }, rosterListData] = await Promise.all([
    supabase.from("incidents").select("id,name,address,city,opened_at").eq("id", params.incidentId).maybeSingle(),
    listVehicleRostersForIncident(params.incidentId)
  ]);

  if (!incident) notFound();

  const allRosters = (rosterListData as VehicleRosterListRow[]).map((row) => ({
    ...row,
    participant_count: numberValue(row.participant_count)
  })).sort(rosterSort);
  const filteredRows = selectedStatuses.length > 0 ? allRosters.filter((row) => selectedStatuses.includes(row.status)) : allRosters;
  const details = (await Promise.all(
    filteredRows.map(async (row) => getVehicleRosterForIncident(params.incidentId, row.id))
  ))
    .filter(Boolean)
    .map((row) => {
      const roster = row as VehicleRosterDetail;
      roster.participants = Array.isArray(roster.participants) ? roster.participants : [];
      roster.participant_count = numberValue(roster.participant_count);
      return roster;
    })
    .sort(rosterSort);

  const activeStatuses = new Set<RosterStatus>(["draft", "ready", "en_route"]);
  const activeParticipants = new Set<string>();
  details.forEach((roster) => {
    if (!activeStatuses.has(roster.status)) return;
    roster.participants.forEach((participant) => activeParticipants.add(participantKey(participant)));
  });
  const totals = {
    total: details.length,
    draft: details.filter((roster) => roster.status === "draft").length,
    ready: details.filter((roster) => roster.status === "ready").length,
    enRoute: details.filter((roster) => roster.status === "en_route").length,
    arrived: details.filter((roster) => roster.status === "arrived").length,
    cancelled: details.filter((roster) => roster.status === "cancelled").length,
    peopleCurrentlyAllocated: activeParticipants.size,
    vehiclesEnRoute: details.filter((roster) => roster.status === "en_route" && roster.vehicle_license_plate).length,
    participantAssignments: details.reduce((sum, roster) => sum + uniqueParticipantCount(roster.participants), 0)
  };
  const filtersLabel = selectedStatuses.length > 0 ? selectedStatuses.map(statusFilterLabel).join(", ") : "הכל";

  return (
    <main className={`page vehicle-roster-print-page printable-report roster-report-mode-${mode}`} dir="rtl">
      <div className="header no-print vehicle-roster-print-toolbar">
        <div>
          <p className="eyebrow">דוח מרכז שבצ"קים</p>
          <h1>דוח מרכז שבצ"קים</h1>
          <p className="muted">הדוח נטען מנתונים עדכניים בזמן פתיחת המסך.</p>
        </div>
        <div className="actions">
          <VehicleRosterPrintButton />
          <Link className="button secondary" href={`/incidents/${params.incidentId}/personnel/rosters`}>חזרה לרשימת שבצ"קים</Link>
        </div>
      </div>

      <form className="vehicle-roster-report-options no-print" method="get">
        <label>
          מצב דוח
          <select name="mode" defaultValue={mode}>
            <option value="detailed">דוח מפורט</option>
            <option value="summary">דוח תקציר</option>
          </select>
        </label>
        <fieldset>
          <legend>סטטוסים להדפסה</legend>
          {ROSTER_REPORT_STATUSES.map((status) => (
            <label key={status}>
              <input
                type="checkbox"
                name="statuses"
                value={status === "all" ? "" : status}
                defaultChecked={status === "all" ? selectedStatuses.length === 0 : selectedStatuses.includes(status)}
              />
              {statusFilterLabel(status)}
            </label>
          ))}
        </fieldset>
        <button className="button secondary" type="submit">עדכן דוח</button>
      </form>

      <article className="vehicle-roster-print-document central-roster-print">
        <header className="vehicle-roster-print-header">
          <div>
            <p className="eyebrow">מערכת ינשוף · יחידת החילוץ</p>
            <h1>דוח מרכז שבצ"קים</h1>
            <h2>{text((incident as RosterPrintIncident).name)}</h2>
          </div>
          <dl>
            <div><dt>מספר אירוע</dt><dd>-</dd></div>
            <div><dt>הופק</dt><dd>{formatPrintDateTime(generatedAt)}</dd></div>
            <div><dt>מסננים</dt><dd>{filtersLabel}</dd></div>
            <div><dt>מצב דוח</dt><dd>{reportModeLabel(mode)}</dd></div>
          </dl>
        </header>

        <section className="roster-print-section">
          <h3>סיכום תפעולי</h3>
          <div className="roster-report-kpis">
            <Kpi label={'סה\"כ שבצ\"קים בדוח'} value={totals.total} />
            <Kpi label="טיוטה" value={totals.draft} />
            <Kpi label="מוכן ליציאה" value={totals.ready} />
            <Kpi label="בדרך" value={totals.enRoute} />
            <Kpi label="הגיע ליעד" value={totals.arrived} />
            <Kpi label="בוטל" value={totals.cancelled} />
            <Kpi label="אנשים מוקצים כעת" value={totals.peopleCurrentlyAllocated} />
            <Kpi label="רכבים בדרך" value={totals.vehiclesEnRoute} />
            <Kpi label="שיוכי משתתפים בדוח" value={totals.participantAssignments} />
          </div>
        </section>

        {details.length === 0 ? (
          <section className="roster-print-section roster-print-empty">
            <h3>אין נתונים להדפסה</h3>
            <p>{allRosters.length === 0 ? "לא נמצאו שבצ\"קים להדפסה." : "לא נמצאו שבצ\"קים התואמים למסננים שנבחרו."}</p>
          </section>
        ) : mode === "summary" ? (
          <section className="roster-print-section">
            <h3>שבצ"קים - תקציר</h3>
            <table className="roster-print-table roster-summary-print-table">
              <thead>
                <tr>
                  <th>שבצ"ק</th>
                  <th>סטטוס</th>
                  <th>רכב</th>
                  <th>נהג</th>
                  <th>מפקד נסיעה</th>
                  <th>מוצא</th>
                  <th>יעד</th>
                  <th>יציאה</th>
                  <th>הגעה</th>
                  <th>משתתפים</th>
                </tr>
              </thead>
              <tbody>
                {details.map((roster) => (
                  <tr key={roster.id}>
                    <td><strong>{roster.display_number}</strong></td>
                    <td>{statusLabel(roster.status)}</td>
                    <td>{text(roster.vehicle_license_plate)}</td>
                    <td>{driverNames(roster.participants)}</td>
                    <td>{commanderNames(roster.participants)}</td>
                    <td>{text(roster.origin_text)}</td>
                    <td>{text(roster.destination_text)}</td>
                    <td>{formatPrintDateTime(roster.actual_departure_at ?? roster.planned_departure_at)}</td>
                    <td>{formatPrintDateTime(roster.actual_arrival_at)}</td>
                    <td>{uniqueParticipantCount(roster.participants)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="roster-print-section roster-detailed-list">
            <h3>שבצ"קים - פירוט</h3>
            {details.map((roster) => {
              const relationship = rosterRelationshipText(roster, allRosters);
              return (
                <article className="roster-report-card" key={roster.id}>
                  <header>
                    <div>
                      <p className="eyebrow">{rosterKindLabel(roster)}</p>
                      <h4>שבצ"ק {roster.display_number}</h4>
                    </div>
                    <span className="roster-print-status">{statusLabel(roster.status)}</span>
                  </header>
                  <dl className="roster-print-grid compact">
                    <div><dt>סוג תנועה</dt><dd>{movementLabel(roster.movement_type)}</dd></div>
                    <div><dt>רכב</dt><dd>{text(roster.vehicle_license_plate)}</dd></div>
                    <div><dt>זיהוי רכב</dt><dd>{text(roster.vehicle_description)}</dd></div>
                    <div><dt>מוצא</dt><dd>{text(roster.origin_text)}</dd></div>
                    <div><dt>יעד</dt><dd>{text(roster.destination_text)}</dd></div>
                    <div><dt>נהג</dt><dd>{driverNames(roster.participants)}</dd></div>
                    <div><dt>מפקד נסיעה</dt><dd>{commanderNames(roster.participants)}</dd></div>
                    <div><dt>יציאה מתוכננת</dt><dd>{formatPrintDateTime(roster.planned_departure_at)}</dd></div>
                    <div><dt>יציאה בפועל</dt><dd>{formatPrintDateTime(roster.actual_departure_at)}</dd></div>
                    <div><dt>הגעה בפועל</dt><dd>{formatPrintDateTime(roster.actual_arrival_at)}</dd></div>
                    <div><dt>משתתפים</dt><dd>{uniqueParticipantCount(roster.participants)}</dd></div>
                    <div className="wide"><dt>הערות</dt><dd>{text(roster.operational_notes)}</dd></div>
                  </dl>
                  {relationship ? <p className="roster-print-note">{relationship}</p> : null}
                  {roster.participants.length === 0 ? (
                    <p className="roster-print-empty">טרם שובצו אנשי צוות.</p>
                  ) : (
                    <table className="roster-print-table participants-mini-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>שם</th>
                          <th>מקור</th>
                          <th>תפקידים</th>
                          <th>הערות</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roster.participants.map((participant, index) => (
                          <tr key={participant.id}>
                            <td>{index + 1}</td>
                            <td>{participant.display_name_snapshot}</td>
                            <td>{sourceText(participant)}</td>
                            <td>{participantRoles(participant)}</td>
                            <td>{text(participant.notes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </article>
              );
            })}
          </section>
        )}

        <footer className="roster-print-footer">
          <span>אירוע: {text((incident as RosterPrintIncident).name)}</span>
          <span>עודכן לדוח: {formatPrintDateTime(generatedAt)}</span>
          <span>המסמך הופק ממערכת ינשוף</span>
        </footer>
      </article>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}