import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listVehicleRostersForIncident, getVehicleRosterForIncident } from "../../../actions";
import { VehicleRosterPrintButton } from "../../print-button";
import {
  commanderNames,
  driverNames,
  formatPrintDateTime,
  formatPrintTime,
  movementLabel,
  participantRoles,
  rosterRelationshipText,
  sourceText,
  statusLabel,
  text,
  uniqueParticipantCount,
  type RosterPrintIncident
} from "../../print-utils";
import { numberValue, type VehicleRosterDetail, type VehicleRosterListRow } from "../../roster-types";

export default async function VehicleRosterPrintPage({
  params
}: {
  params: { incidentId: string; rosterId: string };
}) {
  const supabase = createClient();
  const generatedAt = new Date().toISOString();
  const [{ data: incident }, rosterData, rosterListData] = await Promise.all([
    supabase.from("incidents").select("id,name,address,city,opened_at").eq("id", params.incidentId).maybeSingle(),
    getVehicleRosterForIncident(params.incidentId, params.rosterId),
    listVehicleRostersForIncident(params.incidentId)
  ]);

  if (!incident || !rosterData) notFound();

  const roster = rosterData as VehicleRosterDetail;
  const rosters = (rosterListData as VehicleRosterListRow[]).map((row) => ({
    ...row,
    participant_count: numberValue(row.participant_count)
  }));
  roster.participants = Array.isArray(roster.participants) ? roster.participants : [];
  roster.participant_count = numberValue(roster.participant_count);
  const relationship = rosterRelationshipText(roster, rosters);
  const uniqueCount = uniqueParticipantCount(roster.participants);
  const sameDriverAndCommander =
    driverNames(roster.participants) !== "-" && driverNames(roster.participants) === commanderNames(roster.participants);

  return (
    <main className="page vehicle-roster-print-page printable-report" dir="rtl">
      <div className="header no-print vehicle-roster-print-toolbar">
        <div>
          <p className="eyebrow">הדפסת שבצ"ק</p>
          <h1>שבצ"ק {roster.display_number}</h1>
          <p className="muted">ניתן לבחור "שמירה כ-PDF" בחלון ההדפסה.</p>
        </div>
        <div className="actions">
          <VehicleRosterPrintButton />
          <Link className="button secondary" href={`/incidents/${params.incidentId}/personnel/rosters/${params.rosterId}`}>חזרה לשבצ"ק</Link>
        </div>
      </div>

      <article className="vehicle-roster-print-document individual-roster-print">
        <header className="vehicle-roster-print-header">
          <div>
            <p className="eyebrow">מערכת ינשוף · יחידת החילוץ</p>
            <h1>שבצ"ק תנועת רכב</h1>
            <h2>שבצ"ק {roster.display_number}</h2>
          </div>
          <dl>
            <div><dt>אירוע</dt><dd>{text((incident as RosterPrintIncident).name)}</dd></div>
            <div><dt>מספר אירוע</dt><dd>-</dd></div>
            <div><dt>הופק</dt><dd>{formatPrintDateTime(generatedAt)}</dd></div>
            <div><dt>סטטוס</dt><dd><span className="roster-print-status">{statusLabel(roster.status)}</span></dd></div>
          </dl>
        </header>

        {relationship ? <section className="roster-print-callout"><strong>קשר לשבצ"קים אחרים</strong><p>{relationship}</p></section> : null}

        <section className="roster-print-section">
          <h3>פרטי נסיעה</h3>
          <dl className="roster-print-grid">
            <div><dt>סוג תנועה</dt><dd>{movementLabel(roster.movement_type)}</dd></div>
            <div><dt>מוצא</dt><dd>{text(roster.origin_text)}</dd></div>
            <div><dt>יעד</dt><dd>{text(roster.destination_text)}</dd></div>
            <div><dt>יציאה מתוכננת</dt><dd>{formatPrintDateTime(roster.planned_departure_at)}</dd></div>
            <div><dt>יציאה בפועל</dt><dd>{formatPrintDateTime(roster.actual_departure_at)}</dd></div>
            <div><dt>הגעה בפועל</dt><dd>{formatPrintDateTime(roster.actual_arrival_at)}</dd></div>
            <div className="wide"><dt>הערות נסיעה</dt><dd>{text(roster.operational_notes)}</dd></div>
          </dl>
        </section>

        <section className="roster-print-section">
          <h3>פרטי רכב</h3>
          <dl className="roster-print-grid">
            <div><dt>מספר רכב / רישוי</dt><dd dir="ltr">{text(roster.vehicle_license_plate)}</dd></div>
            <div><dt>זיהוי נוסף</dt><dd>{text(roster.vehicle_description)}</dd></div>
            <div><dt>סוג רכב</dt><dd>{text(roster.vehicle_type)}</dd></div>
            <div className="wide"><dt>הערות לרכב</dt><dd>{text(roster.vehicle_notes)}</dd></div>
          </dl>
        </section>

        <section className="roster-print-section">
          <h3>תפקידי פיקוד</h3>
          <dl className="roster-print-grid command-roles">
            <div><dt>נהג</dt><dd>{driverNames(roster.participants)}</dd></div>
            <div><dt>מפקד נסיעה</dt><dd>{commanderNames(roster.participants)}</dd></div>
            <div><dt>סה"כ משתתפים ייחודיים</dt><dd>{uniqueCount}</dd></div>
          </dl>
          {sameDriverAndCommander ? <p className="roster-print-note">אותו אדם משמש גם כנהג וגם כמפקד נסיעה; הוא נספר פעם אחת בספירת המשתתפים.</p> : null}
        </section>

        <section className="roster-print-section">
          <h3>משתתפים</h3>
          {roster.participants.length === 0 ? (
            <p className="roster-print-empty">טרם שובצו אנשי צוות.</p>
          ) : (
            <table className="roster-print-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>שם מלא</th>
                  <th>טלפון</th>
                  <th>צוות אורגני</th>
                  <th>צוות אד-הוק</th>
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
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>{sourceText(participant)}</td>
                    <td>{participantRoles(participant)}</td>
                    <td>{text(participant.notes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <footer className="roster-print-footer">
          <span>נוצר: {formatPrintDateTime(roster.created_at)}</span>
          <span>עודכן לאחרונה: {formatPrintDateTime(roster.updated_at)}</span>
          <span>המסמך הופק ממערכת ינשוף</span>
          <span>שעת הדפסה: {formatPrintTime(generatedAt)}</span>
        </footer>
      </article>
    </main>
  );
}