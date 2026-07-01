"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw.length > 0 ? raw : null;
}

function requiredValue(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);
  if (!raw) {
    throw new Error(`${label} הוא שדה חובה`);
  }
  return raw;
}

export async function cancelSiteFromListAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("cancel_site", {
    p_site_id: siteId,
    p_reason: requiredValue(formData, "reason", "סיבת ביטול"),
    p_reason_other: nullableValue(formData, "reasonOther")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/sites`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);
  redirect(`/incidents/${incidentId}/sites`);
}

export async function updateSiteFromListAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("update_site_safe_details", {
    p_site_id: siteId,
    p_name: nullableValue(formData, "siteName"),
    p_site_type: requiredValue(formData, "siteType", "סוג אתר"),
    p_city: nullableValue(formData, "city"),
    p_street: requiredValue(formData, "street", "רחוב"),
    p_house_number: requiredValue(formData, "houseNumber", "מספר בית"),
    p_search_reason: nullableValue(formData, "siteDetails"),
    p_search_priority: nullableValue(formData, "searchPriority")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/sites`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);
  redirect(`/incidents/${incidentId}/sites`);
}
