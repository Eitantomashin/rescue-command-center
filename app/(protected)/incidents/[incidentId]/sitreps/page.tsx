import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { CreateSitrepButton } from "./create-sitrep-button";
import type { SituationReportRow } from "./sitrep-types";

export default async function SituationReportsPage({ params, searchParams }: { params: { incidentId: string }; searchParams?: { create?: string; message?: string } }) {
  const supabase = createClient();
  const [{ data: incident }, { data: role }, { data, error }] = await Promise.all([
    supabase.from("incidents").select("id,name").eq("id", params.incidentId).maybeSingle(),
    supabase.rpc("current_user_role"),
    supabase
      .from("situation_reports")
      .select("id,incident_id,report_number,snapshot,commander_decisions,meeting_summary,created_by,created_at")
      .eq("incident_id", params.incidentId)
      .order("report_number", { ascending: false })
  ]);

  if (!incident) notFound();
  const reports = (data ?? []) as SituationReportRow[];
  const canCreate = role === "admin" || role === "commander";

  return (
    <main className="page sitreps-page">
      <div className="header">
        <div>
          <p className="eyebrow">{incident.name}</p>
          <h1>חיתוכי מצב</h1>
          <p className="muted">דוחות פיקודיים הנשמרים כתמונת מצב היסטורית.</p>
        </div>
        {canCreate ? <CreateSitrepButton incidentId={params.incidentId} /> : null}
      </div>

      {error ? <section className="panel"><p className="error">{error.message}</p></section> : null}
      {searchParams?.create === "error" ? <section className="panel"><p className="error">{searchParams.message || "יצירת הדוח נכשלה."}</p></section> : null}
      {reports.length === 0 ? (
        <section className="panel empty-state">
          <h2>טרם נוצרו חיתוכי מצב</h2>
          <p className="muted">הדוח הראשון יתעד את תמונת המצב המבצעית הנוכחית.</p>
          {canCreate ? <CreateSitrepButton incidentId={params.incidentId} /> : null}
        </section>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>מספר דוח</th><th>נוצר בתאריך</th><th>עורך הדוח</th><th>פעולה</th></tr></thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td><strong>חיתוך מצב #{report.report_number}</strong></td>
                    <td>{formatDateTime(report.created_at)}</td>
                    <td>{report.snapshot.author?.display_name || "-"}</td>
                    <td><Link className="button secondary" href={`/incidents/${params.incidentId}/sitreps/${report.id}`}>פתח דוח</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
