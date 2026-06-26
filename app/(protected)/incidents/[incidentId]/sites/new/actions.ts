"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const MAX_IMAGE_DATA_URL_LENGTH = 1_400_000;

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

function integerValue(formData: FormData, key: string, label: string) {
  const parsed = Number.parseInt(requiredValue(formData, key, label), 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} חייב להיות מספר תקין`);
  }

  return parsed;
}

function jsonArrayValue(formData: FormData, key: string, label: string) {
  const raw = requiredValue(formData, key, label);
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} לא נשלחו בצורה תקינה`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} חייבים להיות רשימה תקינה`);
  }

  return parsed;
}

function selectedTeamsValue(formData: FormData) {
  return jsonArrayValue(formData, "teamsPayload", "צוותים").filter(
    (team) =>
      team &&
      typeof team === "object" &&
      "selected" in team &&
      (team as { selected?: unknown }).selected === true
  );
}

function siteTypeValue(formData: FormData) {
  const siteType = value(formData, "siteType") || "rescue_site";

  if (!["rescue_site", "search_site"].includes(siteType)) {
    throw new Error("סוג האתר אינו תקין");
  }

  return siteType;
}

export async function createSiteFromWizard(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const street = requiredValue(formData, "street", "כתובת האתר");
  const houseNumber = requiredValue(formData, "houseNumber", "מספר בית");
  const submittedSiteName = nullableValue(formData, "siteName");
  const siteName = submittedSiteName ?? `${street} ${houseNumber}`;
  const lowestLevel = integerValue(formData, "lowestLevel", "מפלס תחתון");
  const highestLevel = integerValue(formData, "highestLevel", "מפלס עליון");
  const imageDataUrl = nullableValue(formData, "imageDataUrl");
  const siteType = siteTypeValue(formData);

  if (lowestLevel > highestLevel) {
    throw new Error("מפלס תחתון חייב להיות קטן או שווה למפלס עליון");
  }

  if (imageDataUrl && imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("קובץ התמונה גדול מדי לשמירה בשלב זה");
  }

  const zones = jsonArrayValue(formData, "zonesPayload", "אזורים");
  const teams = selectedTeamsValue(formData);

  if (zones.length === 0) {
    throw new Error("יש לבחור לפחות אזור אחד");
  }

  if (teams.length === 0) {
    throw new Error("יש לבחור לפחות צוות אחד");
  }

  const supabase = createClient();

  const createSitePayload = {
    p_incident_id: incidentId,
    p_site_name: siteName,
    p_street: street,
    p_house_number: houseNumber,
    p_city: nullableValue(formData, "city"),
    p_structure_type: nullableValue(formData, "structureType"),
    p_structure_description: nullableValue(formData, "structureDescription"),
    p_damage_severity: nullableValue(formData, "damageSeverity"),
    p_image_name: nullableValue(formData, "imageName"),
    p_image_data_url: imageDataUrl,
    p_lowest_level: lowestLevel,
    p_highest_level: highestLevel,
    p_zones: zones,
    p_teams: teams
  };

  const { data: siteId, error } =
    siteType === "search_site"
      ? await supabase.rpc("create_search_site_from_wizard", {
          ...createSitePayload,
          p_parent_site_id: nullableValue(formData, "parentSiteId"),
          p_search_reason: nullableValue(formData, "searchReason"),
          p_search_priority: nullableValue(formData, "searchPriority")
        })
      : await supabase.rpc("create_site_from_wizard", createSitePayload);

  if (error) {
    throw new Error(error.message);
  }

  redirect(`/incidents/${incidentId}/sites/${siteId}`);
}
