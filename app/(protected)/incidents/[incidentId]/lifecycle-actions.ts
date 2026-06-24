"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function requiredValue(formData: FormData, key: string, label: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) {
    throw new Error(`${label} הוא שדה חובה`);
  }
  return value;
}

function nullableValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

export async function closeIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { data: reportId, error } = await supabase.rpc("close_incident_lifecycle", {
    p_incident_id: incidentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
  redirect(`/incidents/${incidentId}/reports/closure?reportId=${reportId}`);
}

export async function reopenIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("reopen_incident_lifecycle", {
    p_incident_id: incidentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
}

export async function pauseIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("pause_incident_lifecycle", {
    p_incident_id: incidentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
}

export async function renameIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const newName = requiredValue(formData, "newName", "שם אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("rename_incident_admin", {
    p_incident_id: incidentId,
    p_new_name: newName
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath("/incidents");
}

export async function saveClosureReportText(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const reportId = requiredValue(formData, "reportId", "דוח סגירה");
  const supabase = createClient();
  const { error } = await supabase.rpc("update_closure_report_text", {
    p_report_id: reportId,
    p_command_summary: nullableValue(formData, "commandSummary"),
    p_lessons_learned: nullableValue(formData, "lessonsLearned")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/reports/closure`);
}

export async function closeSite(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("close_site_lifecycle", {
    p_site_id: siteId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}`);
}

export async function reopenSite(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("reopen_site_lifecycle", {
    p_site_id: siteId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}`);
}
