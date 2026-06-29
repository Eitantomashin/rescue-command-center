import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";

type SearchSiteReportRow = {
  id: string;
  report_number: number;
  site_id: string;
  snapshot: Record<string, unknown>;
  created_at: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function SearchSiteReportsPage({ params }: { params: { incidentId: string } }) {
  const supabase = createClient();
  const { data: reportsData, error } = await supabase
    .from("search_site_reports")
    .select("id,report_number,site_id,snapshot,created_at")
    .eq("incident_id", params.incidentId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const reports = (reportsData ?? []) as SearchSiteReportRow[];

  return (
    <main className="page">
      <div className="header">
        <div>
          <p className="eyebrow">דוחות</p>
          <h1>דוחות אתרי סריקה</h1>
          <p className="muted">דוחות רשמיים הנשמרים כתמונת מצב היסטורית של אתרי סריקה.</p>
        </div>
      </div>

      <section className="panel">
        {reports.length === 0 ? (
          <div className="empty-state">
            <h2>אין עדיין דוחות סריקה</h2>
            <p className="muted">דוח סריקה מופק מתוך עמוד אתר סריקה לאחר שלפחות דירה אחת נסרקה.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>דוח</th>
                  <th>אתר</th>
                  <th>נסרקו</th>
                  <th>ממצאים פתוחים</th>
                  <th>נוצר</th>
                  <th>פעולה</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => {
                  const snapshot = report.snapshot ?? {};
                  const site = objectValue(snapshot.site);
                  const summary = objectValue(snapshot.summary);
                  const openFindings = numberValue(summary.open_findings);
                  return (
                    <tr key={report.id}>
                      <td><strong>דוח סריקה #{formatNumber(report.report_number)}</strong></td>
                      <td>{textValue(site.name, "אתר סריקה")}</td>
                      <td>{formatNumber(numberValue(summary.scanned_apartments))} / {formatNumber(numberValue(summary.total_apartments))}</td>
                      <td>
                        <span className={`status-badge ${openFindings > 0 ? "warning" : "success"}`}>
                          {openFindings > 0 ? `${formatNumber(openFindings)} פתוחים` : "ללא ממצאים פתוחים"}
                        </span>
                      </td>
                      <td>{formatDateTime(report.created_at)}</td>
                      <td>
                        <Link className="button compact secondary" href={`/incidents/${params.incidentId}/reports/search-sites/${report.id}`}>
                          פתח דוח
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
