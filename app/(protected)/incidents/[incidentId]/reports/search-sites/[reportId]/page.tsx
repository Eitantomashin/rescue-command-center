import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { SearchSiteReportPrintButton } from "../print-button";

type ReportRow = {
  id: string;
  report_number: number;
  snapshot: Record<string, unknown>;
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "טרם התחיל",
  in_progress: "בסריקה",
  has_open_items: "ממצאים פתוחים",
  cleared: "אתר מזוכה",
  not_visited: "טרם נסרקה",
  clear: "תקין",
  no_answer: "אין מענה",
  casualties: "דווחו נפגעים",
  completed: "סיום טיפול / מזוכה"
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
    : [];
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

function casualtyTreatmentText(apartment: Record<string, unknown>) {
  const reported =
    numberValue(apartment.anxiety_casualties_count) +
    numberValue(apartment.physical_casualties_count);
  const hasFinding = reported > 0 || booleanValue(apartment.medical_evacuation);

  if (!hasFinding) return "-";
  return booleanValue(apartment.casualties_resolved) ? "הטיפול הושלם" : "נפגעים פתוחים";
}

function durationText(secondsValue: unknown) {
  const seconds = numberValue(secondsValue);
  if (seconds <= 0) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours <= 0) return `${formatNumber(minutes)} דקות`;
  return `${formatNumber(hours)} שעות ${formatNumber(minutes)} דקות`;
}

function statusLabel(value: unknown) {
  const key = textValue(value);
  return (STATUS_LABELS[key] ?? key) || "-";
}

export default async function SearchSiteReportPage({
  params
}: {
  params: { incidentId: string; reportId: string };
}) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("search_site_reports")
    .select("id,report_number,snapshot,created_at")
    .eq("incident_id", params.incidentId)
    .eq("id", params.reportId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    notFound();
  }

  const report = data as ReportRow;
  const snapshot = report.snapshot ?? {};
  const incident = objectValue(snapshot.incident);
  const site = objectValue(snapshot.site);
  const author = objectValue(snapshot.author);
  const timing = objectValue(snapshot.timing);
  const summary = objectValue(snapshot.summary);
  const casualties = objectValue(snapshot.casualties);
  const damage = objectValue(snapshot.damage);
  const finalSummary = objectValue(snapshot.final_summary);
  const apartments = arrayValue(snapshot.apartments);
  const damageDescriptions = arrayValue(damage.descriptions);
  const hasWarnings =
    numberValue(summary.no_answer_apartments) > 0 ||
    numberValue(summary.casualty_apartments) > 0 ||
    numberValue(casualties.medical_evacuations) > 0;

  return (
    <main className="page search-site-report-page printable-report">
      <div className="header no-print">
        <div>
          <p className="eyebrow">דוחות אתרי סריקה</p>
          <h1>דוח סריקה #{formatNumber(report.report_number)}</h1>
          <p className="muted">{textValue(site.name, "אתר סריקה")} · {formatDateTime(report.created_at)}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" href={`/incidents/${params.incidentId}/reports/search-sites`}>
            לכל דוחות הסריקה
          </Link>
          <SearchSiteReportPrintButton />
        </div>
      </div>

      <article className="panel sitrep-document search-site-report-document">
        <header className="sitrep-print-header">
          <p className="eyebrow">דוח פיקודי</p>
          <h1>דוח אתר סריקה #{formatNumber(report.report_number)}</h1>
          <p>{textValue(incident.name, "אירוע")} · {textValue(site.name, "אתר סריקה")}</p>
          <p>{formatDateTime(report.created_at)} · נוצר על ידי {textValue(author.display_name, "לא ידוע")}</p>
        </header>

        {hasWarnings ? (
          <section className="sitrep-section no-print">
            <h2>אזהרות לפני שימוש בדוח</h2>
            <div className="search-report-warning-list">
              {numberValue(summary.no_answer_apartments) > 0 ? <span>יש דירות ללא מענה</span> : null}
              {numberValue(summary.casualty_apartments) > 0 ? <span>דווחו נפגעים</span> : null}
              {numberValue(casualties.medical_evacuations) > 0 ? <span>קיימים פינויים רפואיים</span> : null}
            </div>
          </section>
        ) : null}

        <section className="sitrep-section">
          <h2>פרטי אתר</h2>
          <div className="summary-grid">
            <div><span className="muted">אירוע</span><strong>{textValue(incident.name, "-")}</strong></div>
            <div><span className="muted">אתר</span><strong>{textValue(site.name, "-")}</strong></div>
            <div><span className="muted">כתובת</span><strong>{textValue(site.address, "-")}</strong></div>
            <div><span className="muted">מפקד אתר</span><strong>{textValue(site.site_commander, "-")}</strong></div>
            <div><span className="muted">תחילת סריקה</span><strong>{formatDateTime(textValue(timing.search_start_time))}</strong></div>
            <div><span className="muted">סיום סריקה</span><strong>{formatDateTime(textValue(timing.search_completion_time))}</strong></div>
            <div><span className="muted">משך</span><strong>{durationText(timing.duration_seconds)}</strong></div>
            <div><span className="muted">סטטוס אתר</span><strong>{statusLabel(site.search_status)}</strong></div>
          </div>
        </section>

        <section className="sitrep-section">
          <h2>סיכום סריקה</h2>
          <div className="summary-grid">
            <div><span className="muted">סה"כ דירות</span><strong>{formatNumber(numberValue(summary.total_apartments))}</strong></div>
            <div><span className="muted">נסרקו</span><strong>{formatNumber(numberValue(summary.scanned_apartments))}</strong></div>
            <div><span className="muted">זוכו</span><strong>{formatNumber(numberValue(summary.cleared_apartments))}</strong></div>
            <div><span className="muted">אין מענה</span><strong>{formatNumber(numberValue(summary.no_answer_apartments))}</strong></div>
            <div><span className="muted">ממצאים פתוחים</span><strong>{formatNumber(numberValue(summary.open_findings))}</strong></div>
            <div><span className="muted">נוספו בשטח</span><strong>{formatNumber(numberValue(summary.manually_added_apartments))}</strong></div>
          </div>
        </section>

        <section className="sitrep-section">
          <h2>נפגעים</h2>
          <div className="summary-grid">
            <div><span className="muted">סה״כ נפגעים דווחו</span><strong>{formatNumber(numberValue(casualties.reported_casualties_total))}</strong></div>
            <div><span className="muted">נפגעים פתוחים</span><strong>{formatNumber(numberValue(casualties.open_casualties_total))}</strong></div>
            <div><span className="muted">נפגעים שטופלו</span><strong>{formatNumber(numberValue(casualties.resolved_casualties_total))}</strong></div>
            <div><span className="muted">נפגעי חרדה</span><strong>{formatNumber(numberValue(casualties.anxiety_casualties_total))}</strong></div>
            <div><span className="muted">נפגעי גוף</span><strong>{formatNumber(numberValue(casualties.physical_casualties_total))}</strong></div>
            <div><span className="muted">פינויים רפואיים</span><strong>{formatNumber(numberValue(casualties.medical_evacuations))}</strong></div>
          </div>
        </section>

        <section className="sitrep-section">
          <h2>נזק לדירות</h2>
          <div className="summary-grid">
            <div><span className="muted">דירות עם נזק</span><strong>{formatNumber(numberValue(damage.damaged_apartments))}</strong></div>
          </div>
          {damageDescriptions.length > 0 ? (
            <ul className="search-report-damage-list">
              {damageDescriptions.map((item, index) => (
                <li key={`${textValue(item.unit_label)}-${index}`}>
                  <strong>קומה {formatNumber(numberValue(item.floor_number))} · {textValue(item.unit_label, "דירה")}</strong>
                  <span>{textValue(item.damage_notes, "-")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">לא דווח נזק לדירות.</p>
          )}
        </section>

        <section className="sitrep-section">
          <h2>פירוט דירות</h2>
          <div className="table-wrap">
            <table className="table sitrep-table">
              <thead>
                <tr>
                  <th>קומה</th>
                  <th>דירה</th>
                  <th>משפחה</th>
                  <th>דיירים</th>
                  <th>סטטוס</th>
                  <th>חרדה</th>
                  <th>גוף</th>
                  <th>פינוי</th>
                  <th>טיפול בנפגעים</th>
                  <th>נזק</th>
                  <th>הערות</th>
                </tr>
              </thead>
              <tbody>
                {apartments.map((apartment) => (
                  <tr key={textValue(apartment.unit_id, `${textValue(apartment.unit_label)}-${textValue(apartment.floor_number)}`)}>
                    <td>{formatNumber(numberValue(apartment.floor_number))}</td>
                    <td>{textValue(apartment.unit_label, "-")}</td>
                    <td>{textValue(apartment.family_name, "-")}</td>
                    <td>{apartment.occupants_count === null || apartment.occupants_count === undefined ? "-" : formatNumber(numberValue(apartment.occupants_count))}</td>
                    <td><span className={`search-unit-status ${textValue(apartment.search_status)}`}>{statusLabel(apartment.search_status)}</span></td>
                    <td>{formatNumber(numberValue(apartment.anxiety_casualties_count))}</td>
                    <td>{formatNumber(numberValue(apartment.physical_casualties_count))}</td>
                    <td>{booleanValue(apartment.medical_evacuation) ? "כן" : "לא"}</td>
                    <td>{casualtyTreatmentText(apartment)}</td>
                    <td>{booleanValue(apartment.has_apartment_damage) ? textValue(apartment.apartment_damage_notes, "כן") : "לא"}</td>
                    <td>{textValue(apartment.notes, "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sitrep-section">
          <h2>סיכום מפקד סופי</h2>
          <div className="summary-grid">
            <div><span className="muted">סטטוס אתר</span><strong>{statusLabel(finalSummary.site_status)}</strong></div>
            <div><span className="muted">אתר מזוכה</span><strong>{booleanValue(finalSummary.site_cleared) ? "כן" : "לא"}</strong></div>
            <div><span className="muted">ממצאים פתוחים</span><strong>{booleanValue(finalSummary.has_open_findings) ? "כן" : "לא"}</strong></div>
          </div>
        </section>
      </article>
    </main>
  );
}
