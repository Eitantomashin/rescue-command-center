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

function sitePath(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  return `/incidents/${incidentId}/sites/${siteId}`;
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

  revalidatePath(path);
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

  revalidatePath(path);
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

  revalidatePath(path);
  redirect(path);
}

export async function linkPersonToUnit(formData: FormData) {
  const path = sitePath(formData);
  const unitId = requiredValue(formData, "unitId", "דירה");
  const personId = requiredValue(formData, "personId", "אדם מבצעי");
  const reason = nullableValue(formData, "reason") ?? "קישור אדם לדירה מתוך מסך אתר";
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

  revalidatePath(path);
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

  revalidatePath(path);
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

  revalidatePath(path);
  redirect(path);
}

export async function updateUnitResident(formData: FormData) {
  const path = sitePath(formData);
  const residentId = requiredValue(formData, "residentId", "דייר");
  const firstName = nullableValue(formData, "firstName");
  const lastName = nullableValue(formData, "lastName");
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
    p_notes: notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path);
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
  const overrideReason = nullableValue(formData, "overrideReason");
  const supabase = createClient();

  const { error } = await supabase.rpc("set_unit_clearance", {
    p_unit_id: unitId,
    p_is_fully_cleared: true,
    p_override_reason: overrideReason
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path);
  redirect(path);
}
