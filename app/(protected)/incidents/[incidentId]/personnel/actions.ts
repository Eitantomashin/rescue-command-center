"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function requiredValue(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);
  if (!raw) {
    throw new Error(`${label} הוא שדה חובה`);
  }
  return raw;
}

export async function setEventPersonnelStatus(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("set_event_personnel_status", {
    p_incident_id: incidentId,
    p_personnel_id: requiredValue(formData, "personnelId", "איש צוות"),
    p_attendance_status: requiredValue(formData, "attendanceStatus", "סטטוס")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/personnel`, "page");
}
