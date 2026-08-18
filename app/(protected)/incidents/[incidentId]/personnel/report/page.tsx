import Link from "next/link";
import { notFound } from "next/navigation";
import { formatNumber } from "@/lib/format";
import { buildIncidentPersonnelReport, type PersonnelReportPerson } from "../personnel-report-builder";
import { PersonnelReportPrintButton } from "./print-button";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function display(value: string | null | undefined, fallback = "לא צוין") {
  return value?.trim() || fallback;
}

function PersonRows({ people, includeOrganicTeam = false, includeAdHocRole = false }: {
  people: Array<PersonnelReportPerson & { adHocRole?: string | null }>;
  includeOrganicTeam?: boolean;
  includeAdHocRole?: boolean;
}) {
  return (
    <tbody>
      {people.map((person, index) => (
        <tr key={`${person.key}-${index}`}>
          <td>{formatNumber(index + 1)}</td>
          <td>{person.firstName}</td>
          <td>{person.lastName || "-"}</td>
          {includeOrganicTeam ? <td>{display(person.organicTeamLabel, "ללא צוות אורגני")}</td> : null}
          {includeAdHocRole ? <td>{display(person.adHocRole, "לא צוין")}</td> : <td>{person.role}</td>}
          <td>
            <span className={person.source === "manual" ? "personnel-report-badge" : undefined}>{person.sourceLabel}</span>
            {person.sourceNote ? <small>{person.sourceNote}</small> : null}
          </td>
          <td dir="ltr">{person.phone ?? "-"}</td>
        </tr>
      ))}
    </tbody>
  );
}

export default async function IncidentPersonnelReportPage({ params }: { params: { incidentId: string } }) {
  const report = await buildIncidentPersonnelReport(params.incidentId);
  if (!report) notFound();

  return (
    <main className="page personnel-report-page" dir="rtl">
      <div className="personnel-report-toolbar no-print">
        <Link className="button secondary" href={`/incidents/${params.incidentId}/personnel`}>חזרה לכוח אדם באירוע</Link>
        <PersonnelReportPrintButton />
      </div>

      <article className="personnel-report-document">
        <header className="personnel-report-header">
          <div>
            <p className="eyebrow">דוח תפעולי</p>
            <h1>דוח כוח אדם</h1>
            <dl className="personnel-report-meta">
              <div><dt>אירוע</dt><dd>{report.incident.name}</dd></div>
              <div><dt>סטטוס</dt><dd>{display(report.incident.status)}</dd></div>
              <div><dt>פתיחת האירוע</dt><dd>{formatDateTime(report.incident.openedAt)}</dd></div>
              <div><dt>מועד הפקה</dt><dd>{formatDateTime(report.generatedAt)}</dd></div>
            </dl>
          </div>
          <div className="personnel-report-total-card">
            <span>סה"כ נוכחים באירוע</span>
            <strong>{formatNumber(report.uniquePresentTotal)}</strong>
          </div>
        </header>

        {report.uniquePresentTotal === 0 ? (
          <section className="personnel-report-section">
            <p className="empty-state">לא נמצאו אנשי צוות שסומנו כנוכחים באירוע.</p>
          </section>
        ) : null}

        <section className="personnel-report-section">
          <h2>סיכום כוח אדם נוכח לפי צוות</h2>
          {report.organicTeams.length === 0 ? (
            <p className="muted">אין צוותים אורגניים עם אנשי צוות נוכחים.</p>
          ) : (
            <table className="personnel-report-table personnel-report-summary-table">
              <thead>
                <tr><th>צוות</th><th>מספר נוכחים</th></tr>
              </thead>
              <tbody>
                {report.organicTeams.map((team) => (
                  <tr key={team.key}><td>{team.label}</td><td>{formatNumber(team.presentCount)}</td></tr>
                ))}
                <tr className="table-total-row"><td>סה"כ בצוותים האורגניים</td><td>{formatNumber(report.organicTeamTotal)}</td></tr>
              </tbody>
            </table>
          )}
          <div className="personnel-report-metrics">
            <div><span>כוח אדם שנוסף ידנית</span><strong>{formatNumber(report.manuallyAddedPresentCount)}</strong></div>
            <div><span>אנשים המשויכים לצוותי אד-הוק</span><strong>{formatNumber(report.adHocAssignedPresentCount)}</strong></div>
            <div><span>כוח אדם נוכח ללא שיוך לצוות</span><strong>{formatNumber(report.unassignedPresentCount)}</strong></div>
            <div><span>סה"כ אנשים נוכחים באירוע</span><strong>{formatNumber(report.uniquePresentTotal)}</strong></div>
          </div>
          <p className="personnel-report-helper">נתוני ההוספה הידנית וצוותי האד-הוק מוצגים בנפרד ואינם מתווספים שוב לסך הכול.</p>
        </section>

        <section className="personnel-report-section">
          <h2>פירוט נוכחים לפי צוות</h2>
          {report.organicTeams.map((team) => (
            <section className="personnel-report-team" key={team.key}>
              <div className="personnel-report-team-header">
                <h3>{team.label}</h3>
                <span>{formatNumber(team.presentCount)} נוכחים</span>
                <small>מפקד: {team.commanderNames.join(", ") || "לא צוין"}</small>
                <small>סגן: {team.deputyNames.join(", ") || "לא צוין"}</small>
              </div>
              <table className="personnel-report-table">
                <thead>
                  <tr><th>מס׳</th><th>שם פרטי</th><th>שם משפחה</th><th>תפקיד</th><th>מקור/הערה</th><th>טלפון</th></tr>
                </thead>
                <PersonRows people={team.people} />
              </table>
            </section>
          ))}
        </section>

        <section className="personnel-report-section">
          <h2>צוותי אד-הוק</h2>
          {report.adHocTeams.length === 0 ? (
            <p className="muted">אין צוותי אד-הוק פעילים עם אנשי צוות נוכחים.</p>
          ) : report.adHocTeams.map((team) => (
            <section className="personnel-report-team" key={team.id}>
              <div className="personnel-report-team-header ad-hoc">
                <h3>{team.name}</h3>
                <span>{formatNumber(team.presentCount)} נוכחים</span>
                <small>משימה: {display(team.purpose)}</small>
                <small>אתר קשור: {display(team.relatedSiteName)}</small>
                <small>מפקד: {display(team.commanderName)}</small>
                {team.notes ? <small>הערות: {team.notes}</small> : null}
              </div>
              <table className="personnel-report-table">
                <thead>
                  <tr><th>מס׳</th><th>שם פרטי</th><th>שם משפחה</th><th>צוות אורגני</th><th>תפקיד בצוות האד-הוק</th><th>מקור</th><th>טלפון</th></tr>
                </thead>
                <PersonRows people={team.people} includeOrganicTeam includeAdHocRole />
              </table>
            </section>
          ))}
        </section>

        <section className="personnel-report-section">
          <h2>כוח אדם ללא שיוך לצוות</h2>
          {report.unassignedPeople.length === 0 ? (
            <p className="muted">אין כוח אדם נוכח ללא שיוך לצוות.</p>
          ) : (
            <table className="personnel-report-table">
              <thead>
                <tr><th>מס׳</th><th>שם פרטי</th><th>שם משפחה</th><th>תפקיד</th><th>מקור</th><th>טלפון</th></tr>
              </thead>
              <PersonRows people={report.unassignedPeople} />
            </table>
          )}
        </section>

        <footer className="personnel-report-footer">המסמך הופק ממערכת ינשוף</footer>
      </article>
    </main>
  );
}
