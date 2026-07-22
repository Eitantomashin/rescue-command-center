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

function optionalNonNegativeInteger(formData: FormData, key: string, label: string) {
  const raw = nullableValue(formData, key);

  if (raw === null) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} חייב להיות מספר חיובי או אפס`);
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

function pagePathWithFlag(path: string, flag: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${flag}=1`;
}

function createAndLinkPath(incidentId: string, siteId: string, residentId: string, returnTo: string | null, teamNumber?: number | null, error?: string | null) {
  const params = new URLSearchParams({
    mode: "create-and-link",
    residentId
  });

  if (returnTo) {
    params.set("returnTo", returnTo);
  }

  if (teamNumber) {
    params.set("team", String(teamNumber));
  }

  if (error) {
    params.set("opLink", error);
  }

  return `/incidents/${incidentId}/sites/${siteId}/operational-numbers?${params.toString()}`;
}

function safeReturnPath(incidentId: string, siteId: string, residentId: string, rawReturnTo: string | null, operationalNumber: number) {
  const fallback = `/incidents/${incidentId}/sites/${siteId}`;
  const allowedPrefix = `/incidents/${incidentId}/sites/${siteId}`;
  const returnTo = rawReturnTo?.startsWith(allowedPrefix) && !rawReturnTo.startsWith("//") && !rawReturnTo.includes("://")
    ? rawReturnTo
    : fallback;
  const separator = returnTo.includes("?") ? "&" : "?";

  return `${returnTo}${separator}residentLinkSuccess=1&linkedResidentId=${encodeURIComponent(residentId)}&createdOperationalNumber=${encodeURIComponent(String(operationalNumber))}`;
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
  const flowMode = nullableValue(formData, "flowMode");
  const linkResidentId = nullableValue(formData, "linkResidentId");
  const returnTo = nullableValue(formData, "returnTo");
  const residentFirstName = nullableValue(formData, "residentFirstName");
  const residentLastName = nullableValue(formData, "residentLastName");
  const residentGender = nullableValue(formData, "residentGender") ?? "unknown";
  const residentAge = optionalNonNegativeInteger(formData, "residentAge", "גיל");
  const residentPhone = nullableValue(formData, "residentPhone");
  const residentStatusId = nullableValue(formData, "residentStatusId");
  const residentNotes = nullableValue(formData, "residentNotes");
  const operationalNumber = await nextOperationalNumber(incidentId, teamNumber);
  const statusId = await defaultPersonStatusId(incidentId);
  const supabase = createClient();

  if (flowMode === "create-and-link" || linkResidentId) {
    if (!linkResidentId) {
      redirect(createAndLinkPath(incidentId, siteId, "", returnTo, teamNumber, "error"));
    }

    const { data: linkResult, error } = await supabase.rpc("create_operational_number_and_link_resident", {
      p_incident_id: incidentId,
      p_site_id: siteId,
      p_resident_id: linkResidentId,
      p_team_number: teamNumber,
      p_operational_number: operationalNumber,
      p_status_id: statusId,
      p_information_source_type: DEFAULT_SOURCE_TYPE,
      p_information_source_name: null,
      p_source_phone: null,
      p_grid_cell: null,
      p_confidence_level: DEFAULT_CONFIDENCE,
      p_reported_at: new Date().toISOString(),
      p_resident_first_name: residentFirstName,
      p_resident_last_name: residentLastName,
      p_resident_age: residentAge,
      p_resident_phone: residentPhone,
      p_resident_status_id: residentStatusId,
      p_resident_notes: residentNotes,
      p_resident_gender: residentGender
    });

    if (error) {
      console.error("Create operational number and link resident failed", {
        incidentId,
        siteId,
        residentId: linkResidentId,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      redirect(createAndLinkPath(incidentId, siteId, linkResidentId, returnTo, teamNumber, "error"));
    }

    const createdNumber = Number((linkResult as { operational_number?: number } | null)?.operational_number ?? operationalNumber);

    revalidatePath(pagePath(incidentId, siteId));
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
    revalidatePath(`/incidents/${incidentId}/war-room`);
    revalidatePath(`/incidents/${incidentId}/operational-log`);
    redirect(safeReturnPath(incidentId, siteId, linkResidentId, returnTo, createdNumber));
  }
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

  const path = pagePath(incidentId, siteId, personId as string, teamNumber);
  revalidatePath(path);
  redirect(pagePathWithFlag(path, "numberCreated"));
}

export async function createForcedOperationalNumber(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const teamNumber = positiveInteger(formData, "teamNumber", "צוות");
  const operationalNumber = positiveInteger(formData, "operationalNumber", "מספר מבצעי מבוקש");
  const reason = requiredValue(formData, "reason", "סיבת פתיחה מאולצת");
  const statusId = await defaultPersonStatusId(incidentId);
  const supabase = createClient();

  const { data: personId, error } = await supabase.rpc("create_forced_operational_number", {
    p_incident_id: incidentId,
    p_site_id: siteId,
    p_team_number: teamNumber,
    p_operational_number: operationalNumber,
    p_status_id: statusId,
    p_reason: reason,
    p_information_source_type: DEFAULT_SOURCE_TYPE,
    p_confidence_level: DEFAULT_CONFIDENCE,
    p_reported_at: new Date().toISOString()
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(pagePath(incidentId, siteId));
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  redirect(pagePath(incidentId, siteId, personId as string, teamNumber));
}

export type ForcedOperationalNumberState = {
  error: string | null;
  success: string | null;
};

function forcedOperationalNumberErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("already exists") ||
    normalized.includes("duplicate") ||
    normalized.includes("unique")
  ) {
    return "המספר המבצעי כבר קיים באירוע ולא ניתן לפתוח אותו שוב.";
  }

  if (
    normalized.includes("not valid for team") ||
    normalized.includes("expected team_number") ||
    normalized.includes("range")
  ) {
    return "המספר המבצעי אינו תואם לצוות שנבחר.";
  }

  if (normalized.includes("reason") || normalized.includes("required") || normalized.includes("שדה חובה")) {
    return "יש להזין סיבת פתיחה מאולצת.";
  }

  return "לא ניתן לפתוח את המספר המבצעי המאולץ. בדוק את הפרטים ונסה שוב.";
}

export async function createForcedOperationalNumberWithState(
  _previousState: ForcedOperationalNumberState,
  formData: FormData
): Promise<ForcedOperationalNumberState> {
  let incidentId = "";
  let siteId = "";
  let teamNumber = 0;
  let personId: string | null = null;

  try {
    incidentId = requiredValue(formData, "incidentId", "אירוע");
    siteId = requiredValue(formData, "siteId", "אתר");
    teamNumber = positiveInteger(formData, "teamNumber", "צוות");
    const operationalNumber = positiveInteger(formData, "operationalNumber", "מספר מבצעי מבוקש");
    const reason = requiredValue(formData, "reason", "סיבת פתיחה מאולצת");
    const statusId = await defaultPersonStatusId(incidentId);
    const supabase = createClient();

    const { data, error } = await supabase.rpc("create_forced_operational_number", {
      p_incident_id: incidentId,
      p_site_id: siteId,
      p_team_number: teamNumber,
      p_operational_number: operationalNumber,
      p_status_id: statusId,
      p_reason: reason,
      p_information_source_type: DEFAULT_SOURCE_TYPE,
      p_confidence_level: DEFAULT_CONFIDENCE,
      p_reported_at: new Date().toISOString()
    });

    if (error) {
      return { error: forcedOperationalNumberErrorMessage(error.message), success: null };
    }

    personId = data as string;
  } catch (error) {
    return { error: forcedOperationalNumberErrorMessage(error), success: null };
  }

  revalidatePath(pagePath(incidentId, siteId));
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  redirect(pagePath(incidentId, siteId, personId, teamNumber));
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

  const path = pagePath(incidentId, siteId, personId, teamNumber);
  revalidatePath(path);
  redirect(pagePathWithFlag(path, "reportSaved"));
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
