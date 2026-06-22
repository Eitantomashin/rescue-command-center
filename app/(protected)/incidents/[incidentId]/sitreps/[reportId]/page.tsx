import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SitrepPrintActions } from "../print-actions";
import { completeSituationReportMeeting } from "../actions";
import { buildSitrepDelta } from "../sitrep-delta";
import { SitrepOperationalReport } from "../sitrep-operational-report";
import type { SituationReportRow } from "../sitrep-types";

export default async function SituationReportDetailPage({
  params,
  searchParams
}: {
  params: { incidentId: string; reportId: string };
  searchParams?: { created?: string; meeting?: string; message?: string };
}) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("situation_reports")
    .select("id,incident_id,report_number,snapshot,commander_decisions,meeting_summary,created_by,created_at,updated_by,updated_at")
    .eq("id", params.reportId)
    .eq("incident_id", params.incidentId)
    .maybeSingle();

  if (error || !data) notFound();
  const report = data as SituationReportRow;
  const { data: previousData } = await supabase
    .from("situation_reports")
    .select("id,incident_id,report_number,snapshot,commander_decisions,meeting_summary,created_by,created_at,updated_by,updated_at")
    .eq("incident_id", params.incidentId)
    .lt("report_number", report.report_number)
    .order("report_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = previousData as SituationReportRow | null;
  const { data: role } = await supabase.rpc("current_user_role");
  const canCompleteMeeting = role === "admin" || role === "commander";
  const delta = buildSitrepDelta(report.snapshot, previous?.snapshot);
  const completionAction = completeSituationReportMeeting.bind(null, params.incidentId, params.reportId);
  const timelineParams = new URLSearchParams({
    from: previous?.created_at ?? report.snapshot.incident.opened_at,
    to: report.created_at
  });

  return (
    <main className="page sitrep-detail-page">
      <div className="header sitrep-screen-toolbar">
        <div>
          {searchParams?.created === "1" ? <p className="success-text">חיתוך המצב נשמר בהצלחה.</p> : null}
          {searchParams?.meeting === "saved" ? <p className="success-text">סיכום הישיבה והחלטות המפקד נשמרו.</p> : null}
          {searchParams?.meeting === "error" ? <p className="error">{searchParams.message || "שמירת סיכום הישיבה נכשלה."}</p> : null}
          <p className="muted">הדוח הוא צילום היסטורי לקריאה בלבד.</p>
        </div>
        <div className="actions">
          <Link className="button secondary" href={`/incidents/${params.incidentId}/sitreps`}>לכל הדוחות</Link>
          <Link className="button secondary" href={`/incidents/${params.incidentId}/timeline?${timelineParams.toString()}`}>הצג פעילות מאז חיתוך מצב קודם</Link>
          <SitrepPrintActions />
        </div>
      </div>
      <SitrepOperationalReport report={report} delta={delta} canEditMeeting={canCompleteMeeting} />
      {canCompleteMeeting ? (
        <section className="panel sitrep-meeting-completion no-print">
          <div><p className="eyebrow">לאחר הישיבה</p><h2>השלמת ישיבת חיתוך מצב</h2><p className="muted">העדכון ישנה רק את הסיכום וההחלטות. תמונת המצב ההיסטורית תישאר ללא שינוי.</p></div>
          <form action={completionAction} className="sitrep-draft-form">
            <label><span>החלטות מפקד</span><textarea className="input" name="commanderDecisions" rows={7} defaultValue={report.commander_decisions ?? ""} placeholder="טרם הושלמו החלטות המפקד" /></label>
            <label><span>סיכום חיתוך מצב</span><textarea className="input" name="meetingSummary" rows={7} defaultValue={report.meeting_summary ?? ""} placeholder="טרם הושלם סיכום הישיבה" /></label>
            <div className="actions"><button className="button" type="submit">שמור סיכום והחלטות</button></div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
