"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const SEARCH_UNIT_STATUSES = new Set(["not_visited", "no_answer", "clear", "casualties", "completed"]);

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

function optionalNonNegativeInteger(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} חייב להיות מספר תקין`);
  }

  return parsed;
}

function optionalSearchStatus(formData: FormData) {
  const status = value(formData, "searchStatus") || "not_visited";
  if (!SEARCH_UNIT_STATUSES.has(status)) {
    throw new Error("סטטוס סריקה לא תקין");
  }
  return status;
}

function mobileSitePath(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  return {
    incidentPath: `/mobile/search/${incidentId}`,
    sitePath: `/mobile/search/${incidentId}/${siteId}`
  };
}

export async function saveMobileSearchUnit(formData: FormData) {
  const { incidentPath, sitePath } = mobileSitePath(formData);
  const siteId = requiredValue(formData, "siteId", "אתר");
  const unitId = requiredValue(formData, "unitId", "דירה");
  const occupantsCount = optionalNonNegativeInteger(formData, "occupantsCount", "מספר דיירים");

  const supabase = createClient();
  const { error } = await supabase.rpc("create_or_update_search_unit", {
    p_site_id: siteId,
    p_unit_id: unitId,
    p_family_name: nullableValue(formData, "familyName"),
    p_occupants_count: occupantsCount,
    p_contact_phone: nullableValue(formData, "contactPhone"),
    p_search_status: optionalSearchStatus(formData),
    p_casualty_psych: formData.get("casualtyPsych") === "on",
    p_casualty_body: formData.get("casualtyBody") === "on",
    p_medical_evacuation: formData.get("medicalEvacuation") === "on",
    p_notes: nullableValue(formData, "notes")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(sitePath, "page");
  revalidatePath(incidentPath, "page");
  redirect(sitePath);
}

export async function completeMobileSearchUnit(formData: FormData) {
  const { incidentPath, sitePath } = mobileSitePath(formData);
  const siteId = requiredValue(formData, "siteId", "אתר");
  const unitId = requiredValue(formData, "unitId", "דירה");

  const supabase = createClient();
  const { error } = await supabase.rpc("complete_search_unit", {
    p_site_id: siteId,
    p_unit_id: unitId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(sitePath, "page");
  revalidatePath(incidentPath, "page");
  redirect(sitePath);
}
