"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { operationalTeamLabel, operationalTeamRange, parseOperationalTeamNumber } from "@/lib/operational-teams";

const DEFAULT_SOURCE_TYPE = "חפ\"ק";
const DEFAULT_CONFIDENCE = "לא ידוע";
const RESERVED_TEAM_NUMBERS = new Set([1, 2, 3, 9, 11, 12, 13]);

type ExistingTeamRow = {
  id: string;
  team_number: number;
  name: string | null;
};

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

function positiveInteger(formData: FormData, key: string, label: string) {
  const parsed = Number.parseInt(requiredValue(formData, key, label), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} חייב להיות מספר חיובי`);
  }

  return parsed;
}

function pagePath(incidentId: string, siteId: string, personId?: string | null, teamNumber?: number | null) {
  const params = new URLSearchParams();

  if (teamNumber) {
    params.set("team", String(teamNumber));
  }

  if (personId) {
    params.set("personId", personId);
  }

  const query = params.toString();
  return `/incidents/${incidentId}/sites/${siteId}/operational-numbers${query ? `?${query}` : ""}`;
}

async function nextOperationalNumber(incidentId: string, teamNumber: number) {
  const supabase = createClient();
  const { min: minNumber, max: maxNumber } = operationalTeamRange(teamNumber);

  const { data, error } = await supabase
    .from("persons")
    .select("operational_number")
    .eq("incident_id", incidentId)
    .gte("operational_number", minNumber)
    .lte("operational_number", maxNumber)
    .order("operational_number", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const latest = data?.[0]?.operational_number;
  const next = latest ? latest + 1 : minNumber;

  if (next > maxNumber) {
    throw new Error(`אין מספרים פנויים ל${operationalTeamLabel(teamNumber)}`);
  }

  return next;
}

async function defaultPersonStatusId(incidentId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("status_types")
    .select("id")
    .eq("category", "person")
    .eq("status_key", "missing")
    .eq("is_active", true)
    .or(`incident_id.is.null,incident_id.eq.${incidentId}`)
    .order("incident_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.id) {
    throw new Error("סטטוס ברירת מחדל נעדר לא נמצא");
  }

  return data.id as string;
}

function nextCustomTeamNumber(existingTeams: ExistingTeamRow[]) {
  const used = new Set(existingTeams.map((team) => team.team_number));

  for (let teamNumber = 4; teamNumber < 100; teamNumber += 1) {
    if (!RESERVED_TEAM_NUMBERS.has(teamNumber) && !used.has(teamNumber)) {
      return teamNumber;
    }
  }

  throw new Error("לא נמצא מספר פנוי לצוות מותאם אישית");
}

export async function createOperationalNumber(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const teamNumber = positiveInteger(formData, "teamNumber", "צוות");
  const operationalNumber = await nextOperationalNumber(incidentId, teamNumber);
  const statusId = await defaultPersonStatusId(incidentId);
  const supabase = createClient();

  const { data: personId, error } = await supabase.rpc("create_operational_number", {
    p_incident_id: incidentId,
    p_site_id: siteId,
    p_team_number: teamNumber,
    p_operational_number: operationalNumber,
    p_status_id: statusId,
    p_first_name: null,
    p_last_name: null,
    p_notes: null,
    p_information_source_type: DEFAULT_SOURCE_TYPE,
    p_information_source_name: null,
    p_source_phone: null,
    p_grid_cell: null,
    p_confidence_level: DEFAULT_CONFIDENCE,
    p_reported_at: new Date().toISOString()
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(pagePath(incidentId, siteId));
  redirect(pagePath(incidentId, siteId, personId as string, teamNumber));
}

export async function updateOperationalPersonName(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "incidentId");
  const siteId = requiredValue(formData, "siteId", "siteId");
  const personId = requiredValue(formData, "personId", "personId");
  const teamNumber = positiveInteger(formData, "teamNumber", "teamNumber");
  const supabase = createClient();

  const { error } = await supabase.rpc("update_operational_person_name", {
    p_person_id: personId,
    p_first_name: nullableValue(formData, "firstName"),
    p_last_name: nullableValue(formData, "lastName")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(pagePath(incidentId, siteId, personId, teamNumber));
  redirect(pagePath(incidentId, siteId, personId, teamNumber));
}

export async function createOperationalReport(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const personId = requiredValue(formData, "personId", "מספר מבצעי");
  const statusId = requiredValue(formData, "statusId", "סטטוס");
  const teamNumber = positiveInteger(formData, "teamNumber", "צוות");
  const supabase = createClient();

  const { error } = await supabase.rpc("save_operational_report_with_person_name", {
    p_person_id: personId,
    p_status_id: statusId,
    p_first_name: nullableValue(formData, "firstName"),
    p_last_name: nullableValue(formData, "lastName"),
    p_information_source_type: requiredValue(formData, "sourceType", "מקור מידע"),
    p_information_source_name: nullableValue(formData, "sourceName"),
    p_source_phone: nullableValue(formData, "sourcePhone"),
    p_grid_cell: nullableValue(formData, "gridCell"),
    p_confidence_level: nullableValue(formData, "confidenceLevel") ?? DEFAULT_CONFIDENCE,
    p_notes: nullableValue(formData, "notes"),
    p_reported_at: new Date().toISOString()
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(pagePath(incidentId, siteId, personId, teamNumber));
  redirect(pagePath(incidentId, siteId, personId, teamNumber));
}

export async function mergeOperationalNumbers(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const sourceOperationalNumber = positiveInteger(formData, "sourceOperationalNumber", "מספר מבצעי מקור");
  const targetOperationalNumber = positiveInteger(formData, "targetOperationalNumber", "מספר מבצעי יעד");
  const supabase = createClient();

  const { data: primaryPersonId, error } = await supabase.rpc("merge_operational_numbers", {
    p_incident_id: incidentId,
    p_source_operational_number: sourceOperationalNumber,
    p_target_operational_number: targetOperationalNumber,
    p_reason: nullableValue(formData, "reason")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(pagePath(incidentId, siteId, primaryPersonId as string));
  redirect(pagePath(incidentId, siteId, primaryPersonId as string));
}

export async function cancelOperationalNumber(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const personId = requiredValue(formData, "personId", "מספר מבצעי");
  const teamNumber = positiveInteger(formData, "teamNumber", "צוות");
  const reason = requiredValue(formData, "cancellationReason", "סיבת ביטול");
  const supabase = createClient();

  const { error } = await supabase.rpc("cancel_operational_number", {
    p_person_id: personId,
    p_reason: reason,
    p_reason_other: nullableValue(formData, "cancellationReasonOther")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(pagePath(incidentId, siteId, null, teamNumber));
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  redirect(pagePath(incidentId, siteId, null, teamNumber));
}

export async function openOperationalTeam(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const teamChoice = requiredValue(formData, "teamChoice", "צוות");
  const customTeam = nullableValue(formData, "customTeam");
  const supabase = createClient();
  const { data: existingTeamsData, error: existingTeamsError } = await supabase
    .from("teams")
    .select("id,team_number,name")
    .eq("incident_id", incidentId)
    .eq("is_active", true);

  if (existingTeamsError) {
    throw new Error(existingTeamsError.message);
  }

  const existingTeams = (existingTeamsData ?? []) as ExistingTeamRow[];
  const customTeamName = customTeam?.trim() ?? "";
  let teamNumber = teamChoice === "other" ? parseOperationalTeamNumber(customTeamName) : Number.parseInt(teamChoice, 10);

  if (teamChoice === "other" && teamNumber && RESERVED_TEAM_NUMBERS.has(teamNumber)) {
    throw new Error("צוות זה שמור. יש לבחור אותו מהרשימה במקום דרך אחר.");
  }

  if (teamChoice === "other" && !teamNumber) {
    if (!customTeamName) {
      throw new Error("יש להזין שם או מספר לצוות אחר");
    }

    teamNumber =
      existingTeams.find((team) => team.name?.trim() === customTeamName)?.team_number ?? nextCustomTeamNumber(existingTeams);
  }

  if (!Number.isInteger(teamNumber) || teamNumber <= 0) {
    throw new Error("יש להזין מספר צוות תקין");
  }

  const teamName = teamChoice === "other" ? customTeamName : operationalTeamLabel(teamNumber);
  const existingTeam = existingTeams.find((team) => team.team_number === teamNumber);

  if (!existingTeam) {
    const { error: teamError } = await supabase.from("teams").insert({
      incident_id: incidentId,
      team_number: teamNumber,
      name: teamName,
      is_active: true
    });

    if (teamError) {
      throw new Error(teamError.message);
    }
  }

  redirect(pagePath(incidentId, siteId, null, teamNumber));
}
