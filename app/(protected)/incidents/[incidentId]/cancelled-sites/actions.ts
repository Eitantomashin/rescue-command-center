"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

export async function restoreCancelledSiteAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("restore_cancelled_site", {
    p_site_id: siteId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/sites`);
  revalidatePath(`/incidents/${incidentId}/cancelled-sites`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  redirect(`/incidents/${incidentId}/cancelled-sites`);
}
