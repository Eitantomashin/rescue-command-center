"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createImmediateSituationReport(incidentId: string, _formData: FormData) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_situation_report", {
    p_incident_id: incidentId,
    p_commander_decisions: null,
    p_meeting_summary: null
  });

  if (error || !data) {
    redirect(`/incidents/${incidentId}/sitreps?create=error&message=${encodeURIComponent(error?.message ?? "יצירת הדוח נכשלה")}`);
  }

  revalidatePath(`/incidents/${incidentId}/sitreps`);
  redirect(`/incidents/${incidentId}/sitreps/${data}?created=1`);
}

export async function completeSituationReportMeeting(incidentId: string, reportId: string, formData: FormData) {
  const supabase = createClient();
  const decisions = String(formData.get("commanderDecisions") ?? "").trim();
  const summary = String(formData.get("meetingSummary") ?? "").trim();
  const { error } = await supabase.rpc("complete_situation_report_meeting", {
    p_report_id: reportId,
    p_commander_decisions: decisions || null,
    p_meeting_summary: summary || null
  });

  if (error) {
    redirect(`/incidents/${incidentId}/sitreps/${reportId}?meeting=error&message=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/incidents/${incidentId}/sitreps/${reportId}`);
  redirect(`/incidents/${incidentId}/sitreps/${reportId}?meeting=saved`);
}
