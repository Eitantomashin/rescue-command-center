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
    sitePath: `/mobile/search/${incidentId}/${siteId}`,
    commanderDashboardPath: `/incidents/${incidentId}`,
    commanderSitePath: `/incidents/${incidentId}/sites/${siteId}`
  };
}

function revalidateSearchSiteViews(paths: ReturnType<typeof mobileSitePath>) {
  revalidatePath(paths.sitePath, "page");
  revalidatePath(paths.incidentPath, "page");
  revalidatePath(paths.commanderDashboardPath, "page");
  revalidatePath(paths.commanderSitePath, "page");
}



export async function saveSearchUnitCard(formData: FormData) {
  const paths = mobileSitePath(formData);
  const siteId = requiredValue(formData, "siteId", "אתר");
  const unitId = requiredValue(formData, "unitId", "דירה");
  const knownRaw = value(formData, "knownPeopleCount");
  const knownPeopleCount = knownRaw === "" ? null : optionalNonNegativeInteger(formData, "knownPeopleCount", "מספר הדיירים הידוע");
  if (knownPeopleCount !== null && knownPeopleCount > 10) throw new Error("ניתן להזין עד 10 דיירים");
  const action = value(formData, "action") || "save";
  if (!["save", "no_answer", "clear", "complete_casualties"].includes(action)) throw new Error("פעולה לא תקינה");
  let residents: unknown;
  let deactivateIds: unknown;
  try {
    residents = JSON.parse(value(formData, "residents") || "[]");
    deactivateIds = JSON.parse(value(formData, "deactivateResidentIds") || "[]");
  } catch { throw new Error("נתוני הדיירים אינם תקינים"); }
  if (!Array.isArray(residents) || !Array.isArray(deactivateIds)) throw new Error("נתוני הדיירים אינם תקינים");
  const residentStatuses = new Set(["not_checked", "resident_clear", "anxiety_casualty", "physical_casualty", "deceased"]);
  const genders = new Set(["unknown", "male", "female"]);
  residents = residents.map((resident) => {
    if (!resident || typeof resident !== "object") throw new Error("נתוני דייר אינם תקינים");
    const row = resident as Record<string, unknown>;
    const status = String(row.status_key ?? "not_checked");
    const gender = String(row.gender ?? "unknown");
    if (!residentStatuses.has(status) || !genders.has(gender)) throw new Error("סטטוס או מגדר דייר אינם תקינים");
    return { ...row, status_key: status, gender, requires_medical_evacuation: status === "physical_casualty" && row.requires_medical_evacuation === true };
  });
  const supabase = createClient();
  const { error } = await supabase.rpc("save_search_unit_card", {
    p_site_id: siteId, p_unit_id: unitId, p_known_people_count: knownPeopleCount,
    p_has_apartment_damage: formData.get("hasApartmentDamage") === "yes",
    p_apartment_damage_notes: nullableValue(formData, "apartmentDamageNotes"),
    p_notes: nullableValue(formData, "notes"), p_residents: residents,
    p_deactivate_resident_ids: deactivateIds, p_action: action
  });
  if (error) throw new Error(error.message);
  revalidateSearchSiteViews(paths);
  redirect(paths.sitePath);
}

export async function addMobileSearchUnit(formData: FormData) {
  const paths = mobileSitePath(formData);
  const siteId = requiredValue(formData, "siteId", "אתר");
  const floorId = requiredValue(formData, "floorId", "קומה");

  const supabase = createClient();
  const { error } = await supabase.rpc("add_search_site_manual_unit", {
    p_site_id: siteId,
    p_floor_id: floorId,
    p_reported_unit_number: nullableValue(formData, "reportedUnitNumber"),
    p_notes: nullableValue(formData, "manualUnitNotes")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidateSearchSiteViews(paths);
  redirect(paths.sitePath);
}
