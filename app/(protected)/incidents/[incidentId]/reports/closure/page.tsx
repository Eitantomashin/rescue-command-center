import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { saveClosureReportText } from "../../lifecycle-actions";
import { ClosureReportPrintButton } from "./print-button";

type ClosureReportRow = {
  id: string;
  incident_id: string;
  report_number: number;
  snapshot: Record<string, unknown>;
  command_summary: string | null;
  lessons_learned: string | null;
  created_at: string;
};

type PersonnelCounts = {
  present: number;
  enRoute: number;
  unavailable: number;
  inactive: number;
  total: number;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function personName(person: Record<string, unknown>) {
  return [person.first_name, person.last_name].map((value) => textValue(value)).filter(Boolean).join(" ") ||
    [person.resident_first_name, person.resident_last_name].map((value) => textValue(value)).filter(Boolean).join(" ") ||
    "שם לא ידוע";
}

export default async function ClosureReportPage({
  params,
  searchParams
}: {
  params: { incidentId: string };
  searchParams?: { reportId?: string };
}) {
  const supabase = createClient();
  const [{ data: reportsData }, { data: canControl }] = await Promise.all([
    supabase
      .from("closure_reports")
      .select("id,incident_id,report_number,snapshot,command_summary,lessons_learned,created_at")
      .eq("incident_id", params.incidentId)
      .order("report_number", { ascending: false }),
    supabase.rpc("can_control_incident_lifecycle", { p_incident_id: params.incidentId })
  ]);

  const reports = (reportsData ?? []) as ClosureReportRow[];
  const report = searchParams?.reportId
    ? reports.find((item) => item.id === searchParams.reportId)
    : reports[0];

  if (!report) {
    return (
      <main className="page closure-report-page">
        <div className="header">
          <div>
            <p className="eyebrow">דוחות</p>
            <h1>דוח סגירת אירוע</h1>
            <p className="muted">עדיין לא נוצר דוח סגירת אירוע.</p>
          </div>
        </div>
        <section className="panel empty-state">
          <h2>אין דוח סגירה</h2>
          <p className="muted">דוח הסגירה נוצר אוטומטית בעת סגירת פעילות באירוע.</p>
          <Link className="button secondary" href={`/incidents/${params.incidentId}`}>חזרה לדשבורד</Link>
        </section>
      </main>
    );
  }

  const snapshot = report.snapshot ?? {};
  const incident = objectValue(snapshot.incident);
  const summary = objectValue(snapshot.summary);
  const latestSitrep = objectValue(snapshot.latest_sitrep);
  const sites = arrayValue(snapshot.sites);
  const teams = arrayValue(snapshot.teams);
  const operationalNumbers = arrayValue(snapshot.operational_numbers).filter((person) => !booleanValue(person.is_merged));
  const personnel = arrayValue(snapshot.personnel);
  const personnelCounts = personnel.reduce<PersonnelCounts>(
    (counts, row) => {
      const status = textValue(row.attendance_status, "unavailable");
      counts.total += 1;
      if (status === "present") counts.present += 1;
      else if (status === "en_route") counts.enRoute += 1;
      else if (status === "inactive") counts.inactive += 1;
      else counts.unavailable += 1;
      return counts;
    },
    { present: 0, enRoute: 0, unavailable: 0, inactive: 0, total: 0 }
  );

  if (!incident.id) {
    notFound();
  }

  return (
    <main className="page closure-report-page printable-report">
      <div className="header no-print">
        <div>
          <p className="eyebrow">דוחות</p>
          <h1>דוח סגירת אירוע</h1>
          <p className="muted">גרסה #{formatNumber(report.report_number)} · {formatDateTime(report.created_at)}</p>
        </div>
        <div className="actions">
          <ClosureReportPrintButton />
        </div>
      </div>

      <article className="panel sitrep-document">
        <header className="sitrep-print-header">
          <p className="eyebrow">דוח פיקודי</p>
          <h1>דוח סגירת אירוע #{formatNumber(report.report_number)}</h1>
          <p>{textValue(incident.name, "אירוע")} · {textValue(incident.city)} {textValue(incident.address)}</p>
        </header>

        <section className="sitrep-section">
          <h2>פרטי אירוע</h2>
          <div className="summary-grid">
            <div><span className="muted">נפתח</span><strong>{formatDateTime(textValue(incident.opened_at))}</strong></div>
            <div><span className="muted">נסגר</span><strong>{formatDateTime(textValue(incident.closed_at))}</strong></div>
            <div><span className="muted">פער מבצעי סופי</span><strong>{formatNumber(numberValue(summary.operational_gap))}</strong></div>
            <div><span className="muted">מספרים מבצעיים</span><strong>{formatNumber(numberValue(summary.active_operational_numbers_count))}</strong></div>
            <div><span className="muted">אתרים</span><strong>{formatNumber(sites.length)}</strong></div>
            <div><span className="muted">חיתוך מצב אחרון</span><strong>{latestSitrep.report_number ? `#${formatNumber(numberValue(latestSitrep.report_number))}` : "אין"}</strong></div>
          </div>
        </section>

        <section className="sitrep-section">
          <h2>סיכום אתרים סופי</h2>
          <div className="table-wrap">
            <table className="table sitrep-table">
              <thead><tr><th>אתר</th><th>פוטנציאל מעודכן</th><th>מספרים פעילים</th><th>פער</th><th>סטטוס</th></tr></thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={textValue(site.site_id, textValue(site.name))}>
                    <td>{textValue(site.name, `אתר ${numberValue(site.site_number)}`)}</td>
                    <td>{formatNumber(numberValue(site.updated_potential))}</td>
                    <td>{formatNumber(numberValue(site.active_operational_numbers_count))}</td>
                    <td>{formatNumber(numberValue(site.operational_gap))}</td>
                    <td>{textValue(site.lifecycle_status, textValue(site.site_status_label, "-"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sitrep-section">
          <h2>מספרים מבצעיים סופיים</h2>
          <div className="table-wrap">
            <table className="table sitrep-table">
              <thead><tr><th>מספר</th><th>שם</th><th>סטטוס</th><th>צוות</th><th>אתר</th><th>הערות</th></tr></thead>
              <tbody>
                {operationalNumbers.map((person) => (
                  <tr key={textValue(person.person_id, String(person.operational_number))}>
                    <td><strong>#{formatNumber(numberValue(person.operational_number))}</strong></td>
                    <td>{personName(person)}</td>
                    <td>{textValue(person.latest_report_status_label, textValue(person.current_status_label, "לא ידוע"))}</td>
                    <td>{formatNumber(numberValue(person.team_number))}</td>
                    <td>{textValue(person.site_name, "ללא אתר")}</td>
                    <td>{textValue(person.latest_notes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sitrep-section">
          <h2>כוח אדם</h2>
          <div className="summary-grid">
            <div><span className="muted">נוכח</span><strong>{formatNumber(personnelCounts.present)}</strong></div>
            <div><span className="muted">בדרך</span><strong>{formatNumber(personnelCounts.enRoute)}</strong></div>
            <div><span className="muted">לא זמין</span><strong>{formatNumber(personnelCounts.unavailable)}</strong></div>
            <div><span className="muted">לא פעיל</span><strong>{formatNumber(personnelCounts.inactive)}</strong></div>
            <div><span className="muted">סה״כ</span><strong>{formatNumber(personnelCounts.total)}</strong></div>
            <div><span className="muted">צוותים פעילים</span><strong>{formatNumber(teams.length)}</strong></div>
          </div>
        </section>

        <section className="sitrep-section">
          <h2>השלמת דוח סגירה</h2>
          <div className="sitrep-text-block">
            <h3>סיכום מפקד</h3>
            <p>{report.command_summary || "טרם הוזן סיכום מפקד."}</p>
          </div>
          <div className="sitrep-text-block">
            <h3>לקחים ראשוניים</h3>
            <p>{report.lessons_learned || "טרם הוזנו לקחים ראשוניים."}</p>
          </div>
        </section>
      </article>

      {canControl ? (
        <section className="panel no-print">
          <h2>עריכת השלמת דוח סגירה</h2>
          <form action={saveClosureReportText} className="action-form">
            <input type="hidden" name="incidentId" value={params.incidentId} />
            <input type="hidden" name="reportId" value={report.id} />
            <label>
              סיכום מפקד
              <textarea className="input" name="commandSummary" rows={5} defaultValue={report.command_summary ?? ""} />
            </label>
            <label>
              לקחים ראשוניים
              <textarea className="input" name="lessonsLearned" rows={5} defaultValue={report.lessons_learned ?? ""} />
            </label>
            <button className="button" type="submit">שמור השלמת דוח</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
