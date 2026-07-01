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

function optionalPositiveInteger(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} חייב להיות מספר חיובי`);
  }

  return parsed;
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

function optionalInteger(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} חייב להיות מספר תקין`);
  }

  return parsed;
}

function sitePath(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  return `/incidents/${incidentId}/sites/${siteId}`;
}

function structureErrorPath(path: string, message: string) {
  return `${path}?structureError=${encodeURIComponent(message)}`;
}

function structureErrorMessage(message: string) {
  if (message.includes("Cannot remove apartment with active operational numbers")) {
    return "\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05DE\u05D7\u05D5\u05E7 \u05D9\u05D7\u05D9\u05D3\u05D4 \u05E9\u05DE\u05E7\u05D5\u05E9\u05E8\u05D9\u05DD \u05D0\u05DC\u05D9\u05D4 \u05DE\u05E1\u05E4\u05E8\u05D9\u05DD \u05DE\u05D1\u05E6\u05E2\u05D9\u05D9\u05DD \u05E4\u05E2\u05D9\u05DC\u05D9\u05DD.";
  }

  if (message.includes("Cannot remove apartment with important resident data")) {
    return "\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05DE\u05D7\u05D5\u05E7 \u05D9\u05D7\u05D9\u05D3\u05D4 \u05E2\u05DD \u05E4\u05E8\u05D8\u05D9 \u05D3\u05D9\u05D9\u05E8 \u05D0\u05DE\u05D9\u05EA\u05D9\u05D9\u05DD. \u05E0\u05D9\u05EA\u05DF \u05DC\u05DE\u05D7\u05D5\u05E7 \u05E8\u05E7 \u05D9\u05D7\u05D9\u05D3\u05D4 \u05E9\u05DE\u05DB\u05D9\u05DC\u05D4 \u05D3\u05D9\u05D9\u05E8\u05D9\u05DD \u05E8\u05D9\u05E7\u05D9\u05DD \u05D1\u05DC\u05D1\u05D3.";
  }

  if (message.includes("closed or archived")) {
    return "לא ניתן לשנות מבנה באתר או אירוע סגור.";
  }

  if (message.includes("duplicate key") || message.includes("already exists")) {
    return "כבר קיימת דירה עם סימון זה בקומה.";
  }

  return message || "לא ניתן להשלים את שינוי המבנה.";
}

function revalidateSiteSurfaces(incidentId: string, siteId: string) {
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/sites`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);
}

function suffixList(formData: FormData) {
  const raw = value(formData, "suffixes");
  const suffixes = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return suffixes.length > 0 ? suffixes : ["א׳", "ב׳"];
}

async function getUnitContext(unitId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("units")
    .select("id,incident_id,site_id,floor_id,unit_number")
    .eq("id", unitId)
    .single();

  if (error || !data) {
    throw new Error("לא נמצאה דירה מתאימה לפעולה");
  }

  return data as {
    id: string;
    incident_id: string;
    site_id: string;
    floor_id: string;
    unit_number: string;
  };
}

export async function updateSiteDetails(formData: FormData) {
  const path = sitePath(formData);
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
    p_search_reason: nullableValue(formData, "searchReason"),
    p_search_priority: nullableValue(formData, "searchPriority")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidateSiteSurfaces(incidentId, siteId);
  redirect(path);
}

export async function cancelSiteAction(formData: FormData) {
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

  revalidateSiteSurfaces(incidentId, siteId);
  redirect(`/incidents/${incidentId}/sites`);
}

export async function createUnitResident(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "דירה");
  const firstName = nullableValue(formData, "firstName");
  const lastName = nullableValue(formData, "lastName");
  const age = optionalNonNegativeInteger(formData, "age", "גיל");
  const phone = nullableValue(formData, "phone");
  const statusId = nullableValue(formData, "statusId");
  const notes = nullableValue(formData, "notes");

  const supabase = createClient();
  const { error } = await supabase.rpc("create_unit_resident", {
    p_unit_id: unitId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_age: age,
    p_phone: phone,
    p_status_id: statusId,
    p_notes: notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function createGeneralAreaResident(formData: FormData) {
  const path = sitePath(formData);
  const siteId = requiredValue(formData, "siteId", "אתר");
  const firstName = nullableValue(formData, "firstName");
  const lastName = nullableValue(formData, "lastName");
  const age = optionalNonNegativeInteger(formData, "age", "גיל");
  const phone = nullableValue(formData, "phone");
  const statusId = nullableValue(formData, "statusId");
  const notes = nullableValue(formData, "notes");

  const supabase = createClient();
  const { error } = await supabase.rpc("create_general_area_resident", {
    p_site_id: siteId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_age: age,
    p_phone: phone,
    p_status_id: statusId,
    p_notes: notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function createOperationalPerson(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "דירה");
  const statusId = requiredValue(formData, "statusId", "סטטוס אדם");
  const firstName = nullableValue(formData, "firstName");
  const lastName = nullableValue(formData, "lastName");
  const age = optionalNonNegativeInteger(formData, "age", "גיל");
  const phone = nullableValue(formData, "phone");
  const notes = nullableValue(formData, "notes");
  const operationalNumber = optionalPositiveInteger(formData, "operationalNumber", "מספר מבצעי");

  if (!operationalNumber) {
    throw new Error("מספר מבצעי הוא שדה חובה");
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("create_operational_person", {
    p_unit_id: unitId,
    p_status_id: statusId,
    p_operational_number: operationalNumber,
    p_first_name: firstName,
    p_last_name: lastName,
    p_age: age,
    p_phone: phone,
    p_notes: notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function linkPersonToUnit(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "דירה");
  const personId = requiredValue(formData, "personId", "אדם מבצעי");
  const reason = nullableValue(formData, "reason") ?? "קישור מספר מבצעי לדירה מתוך מסך אתר";
  const unit = await getUnitContext(unitId);
  const supabase = createClient();

  const { error } = await supabase.rpc("reassign_person", {
    p_person_id: personId,
    p_site_id: unit.site_id,
    p_floor_id: unit.floor_id,
    p_unit_id: unit.id,
    p_reason: reason
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function openResidentPersonCard(formData: FormData) {
  const path = sitePath(formData);
  const residentId = requiredValue(formData, "residentId", "דייר");
  const statusId = nullableValue(formData, "statusId");
  const operationalNumber = optionalPositiveInteger(formData, "operationalNumber", "מספר מבצעי");
  const notes = nullableValue(formData, "notes");
  const supabase = createClient();

  const { error } = await supabase.rpc("open_resident_person_card", {
    p_resident_id: residentId,
    p_status_id: statusId,
    p_operational_number: operationalNumber,
    p_notes: notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path);
  redirect(path);
}

export async function linkExistingPersonToResident(formData: FormData) {
  const path = sitePath(formData);
  const personId = requiredValue(formData, "personId", "אדם מבצעי");
  const residentId = requiredValue(formData, "residentId", "דייר");
  const reason = nullableValue(formData, "reason");
  const supabase = createClient();

  const { error } = await supabase.rpc("link_person_to_resident", {
    p_person_id: personId,
    p_resident_id: residentId,
    p_reason: reason
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function linkOperationalNumberToResident(formData: FormData) {
  const path = sitePath(formData);
  const residentId = requiredValue(formData, "residentId", "דייר");
  const operationalNumber = optionalPositiveInteger(formData, "operationalNumber", "מספר מבצעי");
  const reason = nullableValue(formData, "reason");

  if (!operationalNumber) {
    throw new Error("מספר מבצעי הוא שדה חובה");
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("link_operational_number_to_resident", {
    p_resident_id: residentId,
    p_operational_number: operationalNumber,
    p_reason: reason
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function updateUnitResident(formData: FormData) {
  const path = sitePath(formData);
  const residentId = requiredValue(formData, "residentId", "דייר");
  const firstName = nullableValue(formData, "firstName");
  const lastName = nullableValue(formData, "lastName");
  const gender = nullableValue(formData, "gender") ?? "unknown";
  const age = optionalNonNegativeInteger(formData, "age", "גיל");
  const phone = nullableValue(formData, "phone");
  const statusId = nullableValue(formData, "statusId");
  const notes = nullableValue(formData, "notes");
  const supabase = createClient();

  const { error } = await supabase.rpc("update_unit_resident", {
    p_resident_id: residentId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_age: age,
    p_phone: phone,
    p_status_id: statusId,
    p_notes: notes,
    p_gender: gender
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path);
  redirect(path);
}

export async function linkImportedResidentToUnitResident(formData: FormData) {
  const path = sitePath(formData);
  const importedResidentId = requiredValue(formData, "importedResidentId", "דייר מיובא");
  const residentId = requiredValue(formData, "residentId", "דייר");
  const supabase = createClient();

  const { error } = await supabase.rpc("link_imported_site_resident", {
    p_imported_resident_id: importedResidentId,
    p_resident_id: residentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function releaseImportedResidentLink(formData: FormData) {
  const path = sitePath(formData);
  const importedResidentId = requiredValue(formData, "importedResidentId", "דייר מיובא");
  const supabase = createClient();

  const { error } = await supabase.rpc("release_imported_site_resident_link", {
    p_imported_resident_id: importedResidentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}
export async function addApartmentToFloor(formData: FormData) {
  const path = sitePath(formData);
  const floorId = requiredValue(formData, "floorId", "קומה");
  const afterUnitNumber = optionalInteger(formData, "position", "מספר דירה");
  const position = afterUnitNumber === null ? null : afterUnitNumber + 1;
  const reason = nullableValue(formData, "reason");
  const supabase = createClient();

  const { error } = await supabase.rpc("add_apartment_to_floor", {
    p_floor_id: floorId,
    p_position: position,
    p_reason: reason
  });

  if (error) {
    redirect(structureErrorPath(path, structureErrorMessage(error.message)));
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function splitApartmentUnit(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "דירה");
  const reason = nullableValue(formData, "reason");
  const supabase = createClient();

  const { error } = await supabase.rpc("split_apartment_unit", {
    p_unit_id: unitId,
    p_suffixes: suffixList(formData),
    p_reason: reason
  });

  if (error) {
    redirect(structureErrorPath(path, structureErrorMessage(error.message)));
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function removeApartmentUnit(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "\u05D9\u05D7\u05D9\u05D3\u05D4");
  const reason = nullableValue(formData, "reason");
  const supabase = createClient();

  const { error } = await supabase.rpc("remove_apartment_unit", {
    p_unit_id: unitId,
    p_reason: reason
  });

  if (error) {
    redirect(structureErrorPath(path, structureErrorMessage(error.message)));
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function deleteEmptyPlaceholderResident(formData: FormData) {
  const path = sitePath(formData);
  const residentId = requiredValue(formData, "residentId", "דייר");
  const supabase = createClient();

  const { error } = await supabase.rpc("delete_empty_placeholder_resident", {
    p_resident_id: residentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path);
  redirect(path);
}

export async function updatePersonStatus(formData: FormData) {
  const path = sitePath(formData);
  const personId = requiredValue(formData, "personId", "אדם מבצעי");
  const statusId = requiredValue(formData, "statusId", "סטטוס אדם");
  const notes = nullableValue(formData, "notes");
  const supabase = createClient();

  const { error } = await supabase.rpc("update_person_status", {
    p_person_id: personId,
    p_new_status_id: statusId,
    p_source_type: "ui",
    p_source_name: "RCC",
    p_notes: notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path);
  redirect(path);
}

export async function updateUnitStatus(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "דירה");
  const statusId = requiredValue(formData, "statusId", "סטטוס דירה");
  const notes = nullableValue(formData, "notes");
  const supabase = createClient();

  const { error } = await supabase.rpc("update_unit_status", {
    p_unit_id: unitId,
    p_new_status_id: statusId,
    p_notes: notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path);
  redirect(path);
}

export async function clearUnit(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "דירה");
  const clearanceReason = requiredValue(formData, "clearanceReason", "סיבת זיכוי");
  const supabase = createClient();

  const { error } = await supabase.rpc("set_unit_clearance", {
    p_unit_id: unitId,
    p_is_fully_cleared: true,
    p_override_reason: clearanceReason
  });

  if (error) {
    redirect(structureErrorPath(path, structureErrorMessage(error.message)));
  }

  revalidatePath(path);
  redirect(path);
}

export async function reopenClearedUnit(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "דירה");
  const supabase = createClient();

  const { error } = await supabase.rpc("set_unit_clearance", {
    p_unit_id: unitId,
    p_is_fully_cleared: false,
    p_override_reason: null
  });

  if (error) {
    redirect(structureErrorPath(path, structureErrorMessage(error.message)));
  }

  revalidatePath(path);
  redirect(path);
}

const SEARCH_UNIT_STATUSES = new Set(["not_visited", "no_answer", "clear", "casualties", "completed"]);

function optionalSearchStatus(formData: FormData) {
  const status = value(formData, "searchStatus") || "not_visited";
  if (!SEARCH_UNIT_STATUSES.has(status)) {
    throw new Error("סטטוס סריקה לא תקין");
  }
  return status;
}

export async function saveSearchUnit(formData: FormData) {
  const path = sitePath(formData);
  const siteId = requiredValue(formData, "siteId", "אתר");
  const unitId = requiredValue(formData, "unitId", "דירה");
  const occupantsCount = optionalNonNegativeInteger(formData, "occupantsCount", "מספר דיירים");
  const anxietyCasualtiesCount = optionalNonNegativeInteger(formData, "anxietyCasualtiesCount", "מספר נפגעי חרדה") ?? 0;
  const physicalCasualtiesCount = optionalNonNegativeInteger(formData, "physicalCasualtiesCount", "מספר נפגעי גוף") ?? 0;

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
    p_notes: nullableValue(formData, "notes"),
    p_anxiety_casualties_count: anxietyCasualtiesCount,
    p_physical_casualties_count: physicalCasualtiesCount,
    p_has_apartment_damage: formData.get("hasApartmentDamage") === "on",
    p_apartment_damage_notes: nullableValue(formData, "apartmentDamageNotes")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function completeSearchUnitAction(formData: FormData) {
  const path = sitePath(formData);
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

  revalidatePath(path, "page");
  redirect(path);
}
