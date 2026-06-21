"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function requiredValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) {
    throw new Error("Missing required value");
  }
  return value;
}

export async function archiveIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId");
  const incidentName = requiredValue(formData, "incidentName");
  const confirmationName = requiredValue(formData, "confirmationName");

  if (confirmationName !== incidentName) {
    throw new Error("Incident name confirmation does not match");
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("archive_incident", {
    p_incident_id: incidentId,
    p_confirmation_name: confirmationName
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/incidents");
}

export async function restoreIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId");
  const supabase = createClient();
  const { error } = await supabase.rpc("restore_incident_from_archive", {
    p_incident_id: incidentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/incidents");
}
