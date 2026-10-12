"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PersonnelActionState = {
  error: string | null;
  success: string | null;
};

export type VehicleRosterActionState = PersonnelActionState & {
  data?: unknown;
  code?: string | null;
};

const INITIAL_ACTION_STATE: PersonnelActionState = {
  error: null,
  success: null
};

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

function optionalValue(formData: FormData, key: string) {
  return value(formData, key) || null;
}

function optionalBoolean(formData: FormData, key: string, defaultValue = false) {
  const raw = formData.get(key);
  if (raw === null) return defaultValue;
  return raw === "on" || raw === "true" || raw === "1";
}

function isUuid(raw: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
}

function organicReinforcementPersonnelPayload(personnelKey: string) {
  const match = /^(roster|manual):([0-9a-f-]+)$/i.exec(personnelKey);
  if (!match || !isUuid(match[2])) return null;

  return match[1].toLowerCase() === "roster"
    ? { p_unit_personnel_id: match[2], p_manual_personnel_id: null }
    : { p_unit_personnel_id: null, p_manual_personnel_id: match[2] };
}

function isActiveAdHocAttendanceBlock(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";

  return code === "55000"
    && message.includes("לא ניתן לשנות נוכחות")
    && /צוות אד.?הוק/.test(message);
}

export async function setEventPersonnelStatus(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const personnelId = value(formData, "personnelId");
  const attendanceStatus = value(formData, "attendanceStatus");

  if (!incidentId || !personnelId || !attendanceStatus) {
    return { error: "יש לבחור סטטוס נוכחות תקין.", success: null };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("set_event_personnel_status", {
    p_incident_id: incidentId,
    p_personnel_id: personnelId,
    p_attendance_status: attendanceStatus
  });

  if (error) {
    logServerActionError("setEventPersonnelStatus", { incidentId, personnelId, attendanceStatus }, error);
    if (isActiveAdHocAttendanceBlock(error)) {
      return {
        error: "לא ניתן לשנות את סטטוס הנוכחות. המחלץ משויך לצוות אד־הוק פעיל. יש לשחרר אותו מהצוות לפני שינוי הנוכחות.",
        success: null
      };
    }

    return { error: friendlyPersonnelError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "סטטוס הנוכחות עודכן." };
}

function friendlyPersonnelError(_error: unknown) {
  return "הפעולה נכשלה. יש לנסות שוב או לפנות למנהל המערכת.";
}

function logServerActionError(action: string, context: Record<string, unknown>, error: unknown) {
  console.error(`[incident-personnel] ${action} failed`, {
    ...context,
    message: error && typeof error === "object" && "message" in error ? error.message : undefined,
    code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    details: error && typeof error === "object" && "details" in error ? error.details : undefined,
    hint: error && typeof error === "object" && "hint" in error ? error.hint : undefined
  });
}

async function revalidatePersonnel(incidentId: string) {
  revalidatePath(`/incidents/${incidentId}/personnel`, "page");
}

export async function addManualIncidentPersonnelAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const organicTeamId = value(formData, "organicTeamId");

  if (!incidentId || !organicTeamId) {
    return { error: "יש לבחור צוות ולמלא את פרטי איש הצוות.", success: null };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_or_reuse_incident_manual_personnel", {
    p_incident_id: incidentId,
    p_first_name: value(formData, "firstName"),
    p_last_name: value(formData, "lastName"),
    p_mobile_phone: value(formData, "mobilePhone"),
    p_organic_team_id: organicTeamId,
    p_role: value(formData, "role") || null,
    p_notes: value(formData, "notes") || null
  });

  if (error) {
    logServerActionError("addManualIncidentPersonnelAction", { incidentId, organicTeamId }, error);
    return { error: friendlyPersonnelError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  const message = typeof data === "object" && data && "message" in data ? String(data.message) : "איש הצוות נוסף לאירוע.";
  return { error: null, success: message };
}

export async function setManualIncidentPersonnelStatusAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const manualPersonnelId = requiredValue(formData, "manualPersonnelId", "איש צוות");
  const supabase = createClient();
  const { error } = await supabase.rpc("set_incident_manual_personnel_status", {
    p_incident_id: incidentId,
    p_manual_personnel_id: manualPersonnelId,
    p_attendance_status: requiredValue(formData, "attendanceStatus", "סטטוס")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/personnel`, "page");
}

export async function createAdHocTeamAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const supabase = createClient();
  const { error } = await supabase.rpc("create_incident_ad_hoc_team", {
    p_incident_id: incidentId,
    p_name: value(formData, "teamName"),
    p_purpose: value(formData, "purpose") || null,
    p_related_site_id: value(formData, "relatedSiteId") || null,
    p_commander_name: value(formData, "commanderName") || null,
    p_notes: value(formData, "notes") || null
  });

  if (error) {
    logServerActionError("createAdHocTeamAction", { incidentId }, error);
    return { error: friendlyPersonnelError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "צוות אד-הוק נוצר." };
}

export async function archiveAdHocTeamAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("archive_incident_ad_hoc_team", {
    p_incident_id: incidentId,
    p_ad_hoc_team_id: requiredValue(formData, "adHocTeamId", "צוות")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/personnel`, "page");
}

export async function updateAdHocTeamAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const adHocTeamId = value(formData, "adHocTeamId");
  const supabase = createClient();
  const { error } = await supabase.rpc("update_incident_ad_hoc_team", {
    p_incident_id: incidentId,
    p_ad_hoc_team_id: adHocTeamId,
    p_name: value(formData, "teamName"),
    p_purpose: value(formData, "purpose") || null,
    p_related_site_id: value(formData, "relatedSiteId") || null,
    p_commander_name: value(formData, "commanderName") || null,
    p_notes: value(formData, "notes") || null
  });

  if (error) {
    logServerActionError("updateAdHocTeamAction", { incidentId, adHocTeamId }, error);
    return { error: friendlyPersonnelError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "צוות האד-הוק עודכן." };
}

export async function addExistingAdHocMemberAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const adHocTeamId = value(formData, "adHocTeamId");
  const memberKey = value(formData, "memberKey");
  const [kind, id] = memberKey.split(":");

  if (!incidentId || !adHocTeamId || !id || !["roster", "manual"].includes(kind)) {
    return { error: "יש לבחור איש צוות לשיוך.", success: null };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("add_incident_ad_hoc_team_member", {
    p_incident_id: incidentId,
    p_ad_hoc_team_id: adHocTeamId,
    p_unit_personnel_id: kind === "roster" ? id : null,
    p_manual_personnel_id: kind === "manual" ? id : null,
    p_notes: value(formData, "notes") || null
  });

  if (error) {
    logServerActionError("addExistingAdHocMemberAction", { incidentId, adHocTeamId, memberKey }, error);
    return { error: friendlyPersonnelError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "איש הצוות נוסף לצוות האד-הוק." };
}

export async function addManualAdHocMemberAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const adHocTeamId = value(formData, "adHocTeamId");
  const supabase = createClient();

  const { data, error } = await supabase.rpc("create_or_reuse_incident_manual_personnel", {
    p_incident_id: incidentId,
    p_first_name: value(formData, "firstName"),
    p_last_name: value(formData, "lastName"),
    p_mobile_phone: value(formData, "mobilePhone"),
    p_organic_team_id: null,
    p_role: value(formData, "role") || null,
    p_notes: value(formData, "notes") || null
  });

  if (error) {
    logServerActionError("addManualAdHocMemberAction:create", { incidentId, adHocTeamId }, error);
    return { error: friendlyPersonnelError(error), success: null };
  }

  const kind = typeof data === "object" && data && "kind" in data ? String(data.kind) : null;
  const id = typeof data === "object" && data && "id" in data ? String(data.id) : null;

  if (!kind || !id) {
    return { error: "לא ניתן היה לזהות את איש הצוות שנוצר.", success: null };
  }

  const { error: assignError } = await supabase.rpc("add_incident_ad_hoc_team_member", {
    p_incident_id: incidentId,
    p_ad_hoc_team_id: adHocTeamId,
    p_unit_personnel_id: kind === "roster" ? id : null,
    p_manual_personnel_id: kind === "manual" ? id : null,
    p_notes: null
  });

  if (assignError) {
    logServerActionError("addManualAdHocMemberAction:assign", { incidentId, adHocTeamId, kind, id }, assignError);
    return { error: friendlyPersonnelError(assignError), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "איש הצוות נוסף לצוות האד-הוק." };
}

export async function removeAdHocTeamMemberAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("remove_incident_ad_hoc_team_member", {
    p_incident_id: incidentId,
    p_member_id: requiredValue(formData, "memberId", "שיוך")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/personnel`, "page");
}

function friendlyAdHocManagementError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";

  if (code === "42501") return "אין לך הרשאה לנהל צוותי אד־הוק באירוע זה.";
  if (code === "22023") return "התפקיד המבצעי שנבחר אינו תקין.";
  if (code === "23505") return "בצוות היעד כבר מוגדר מפקד או סגן מפקד פעיל בתפקיד שנבחר.";
  if (code === "55000") return "ניתן לבצע פעולה רק עבור איש צוות פעיל שנוכח באירוע.";
  if (code === "P0002") return "הצוות או השיוך אינם זמינים עוד. יש לרענן את המסך ולנסות שוב.";
  if (message.includes("Authentication")) return "נדרשת התחברות פעילה כדי לנהל צוותי אד־הוק.";
  return "הפעולה בצוות האד־הוק נכשלה. יש לרענן את הנתונים ולנסות שוב.";
}

function friendlyOrganicTeamReinforcementError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";

  if (code === "42501") return "אין לך הרשאה לנהל תגבור בין צוותים אורגניים באירוע זה.";
  if (code === "22023") return "לא ניתן לבצע את פעולת התגבור עבור הצוות או המחלץ שנבחרו.";
  if (code === "23505") return "למחלץ כבר קיים שיוך מבצעי פעיל בצוות אחר.";
  if (code === "55000") return "ניתן לתגבר או להעביר רק מחלץ פעיל ונוכח באירוע פעיל.";
  if (code === "P0002") return "הצוות, המחלץ או התגבור אינם זמינים עוד. יש לרענן את המסך ולנסות שוב.";
  if (message.includes("Authentication")) return "נדרשת התחברות פעילה כדי לנהל תגבור בין צוותים אורגניים.";
  return "פעולת התגבור לא הושלמה. יש לרענן את הנתונים ולנסות שוב.";
}

export async function assignOrganicTeamReinforcementAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const targetTeamId = value(formData, "targetTeamId");
  const personnelKey = value(formData, "personnelKey");
  const personnelPayload = organicReinforcementPersonnelPayload(personnelKey);

  if (!isUuid(incidentId) || !isUuid(targetTeamId) || !personnelPayload) {
    return { error: "יש לבחור מחלץ וצוות יעד תקינים לתגבור.", success: null };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("assign_incident_organic_team_reinforcement", {
    p_incident_id: incidentId,
    p_target_team_id: targetTeamId,
    ...personnelPayload,
    p_notes: optionalValue(formData, "notes")
  });
  if (error) {
    logServerActionError("assignOrganicTeamReinforcementAction", { incidentId, targetTeamId, personnelKey }, error);
    return { error: friendlyOrganicTeamReinforcementError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "המחלץ תוגבר לצוות האורגני שנבחר." };
}

export async function transferOrganicTeamReinforcementAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const reinforcementId = value(formData, "reinforcementId");
  const targetTeamId = value(formData, "targetTeamId");

  if (!isUuid(incidentId) || !isUuid(reinforcementId) || !isUuid(targetTeamId)) {
    return { error: "יש לבחור תגבור וצוות יעד תקינים להעברה.", success: null };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("transfer_incident_organic_team_reinforcement", {
    p_incident_id: incidentId,
    p_reinforcement_id: reinforcementId,
    p_target_team_id: targetTeamId,
    p_notes: optionalValue(formData, "notes")
  });
  if (error) {
    logServerActionError("transferOrganicTeamReinforcementAction", { incidentId, reinforcementId, targetTeamId }, error);
    return { error: friendlyOrganicTeamReinforcementError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "התגבור הועבר לצוות האורגני שנבחר." };
}

export async function returnOrganicTeamReinforcementAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const reinforcementId = value(formData, "reinforcementId");

  if (!isUuid(incidentId) || !isUuid(reinforcementId)) {
    return { error: "לא ניתן לזהות תגבור תקין להחזרה.", success: null };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("return_incident_organic_team_reinforcement", {
    p_incident_id: incidentId,
    p_reinforcement_id: reinforcementId,
    p_notes: optionalValue(formData, "notes")
  });
  if (error) {
    logServerActionError("returnOrganicTeamReinforcementAction", { incidentId, reinforcementId }, error);
    return { error: friendlyOrganicTeamReinforcementError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "המחלץ הוחזר לצוות האורגני המקורי." };
}

export async function setAdHocTeamMemberRoleAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const memberId = value(formData, "memberId");
  const operationalRole = value(formData, "operationalRole");
  if (!incidentId || !memberId || !["member", "commander", "deputy"].includes(operationalRole)) {
    return { error: "יש לבחור תפקיד מבצעי תקין.", success: null };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("set_incident_ad_hoc_team_member_role", {
    p_incident_id: incidentId,
    p_member_id: memberId,
    p_operational_role: operationalRole
  });
  if (error) {
    logServerActionError("setAdHocTeamMemberRoleAction", { incidentId, memberId, operationalRole }, error);
    return { error: friendlyAdHocManagementError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "התפקיד המבצעי של חבר הצוות עודכן." };
}

export async function transferAdHocTeamMemberAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const memberId = value(formData, "memberId");
  const targetAdHocTeamId = value(formData, "targetAdHocTeamId");
  const targetOperationalRole = value(formData, "targetOperationalRole");
  if (!incidentId || !memberId || !targetAdHocTeamId || !["member", "commander", "deputy"].includes(targetOperationalRole)) {
    return { error: "יש לבחור צוות יעד ותפקיד מבצעי תקינים.", success: null };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("transfer_incident_ad_hoc_team_member", {
    p_incident_id: incidentId,
    p_member_id: memberId,
    p_target_ad_hoc_team_id: targetAdHocTeamId,
    p_target_operational_role: targetOperationalRole,
    p_notes: value(formData, "notes") || null
  });
  if (error) {
    logServerActionError("transferAdHocTeamMemberAction", { incidentId, memberId, targetAdHocTeamId, targetOperationalRole }, error);
    return { error: friendlyAdHocManagementError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "איש הצוות הועבר לצוות האד־הוק שנבחר." };
}

export async function returnAdHocTeamMemberAction(
  _prevState: PersonnelActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<PersonnelActionState> {
  const incidentId = value(formData, "incidentId");
  const memberId = value(formData, "memberId");
  if (!incidentId || !memberId) {
    return { error: "לא ניתן לזהות את שיוך איש הצוות.", success: null };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("return_incident_ad_hoc_team_member", {
    p_incident_id: incidentId,
    p_member_id: memberId,
    p_notes: value(formData, "notes") || null
  });
  if (error) {
    logServerActionError("returnAdHocTeamMemberAction", { incidentId, memberId }, error);
    return { error: friendlyAdHocManagementError(error), success: null };
  }

  await revalidatePersonnel(incidentId);
  return { error: null, success: "איש הצוות שוחרר מצוות האד־הוק ונשאר במצבת כוח האדם באירוע." };
}

function rosterActionResult(data: unknown, fallback: string): VehicleRosterActionState {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (record.success === false) {
      return {
        error: rosterBusinessError(record),
        success: null,
        code: typeof record.code === "string" ? record.code : null,
        data
      };
    }
  }

  return { error: null, success: fallback, data };
}

function rosterBusinessError(record: Record<string, unknown>) {
  const code = typeof record.code === "string" ? record.code : "";
  const displayNumber = typeof record.conflicting_roster_display_number === "string" ? record.conflicting_roster_display_number : null;
  const status = typeof record.conflicting_roster_status === "string" ? record.conflicting_roster_status : null;
  const statusText = status ? ` בסטטוס ${status}` : "";

  if (code === "missing_required_fields") return "השבצ\"ק עדיין לא מוכן ליציאה. יש להשלים את הפרטים המסומנים באזור מוכנות ליציאה.";
  if (code === "vehicle_conflict") return "הרכב משויך כעת לשבצ\"ק פעיל אחר.";
  if (code === "person_conflict" || code === "person_already_allocated") {
    return displayNumber
      ? `אחד מאנשי הצוות כבר משויך לשבצ\"ק ${displayNumber}${statusText}. יש להסיר אותו מהשבצ\"ק הפעיל לפני שיוך חדש.`
      : "אחד מאנשי הצוות כבר משויך לשבצ\"ק פעיל אחר.";
  }
  if (code === "invalid_transition") return "לא ניתן לבצע את שינוי הסטטוס מהמצב הנוכחי.";
  if (code === "source_roster_not_found") return "שבצ\"ק המקור לא נמצא באירוע הזה.";
  if (code === "source_roster_not_arrived") return "ניתן ליצור נסיעת המשך רק לאחר שהשבצ\"ק הגיע ליעד.";
  if (code === "source_roster_missing_destination") return "לא ניתן ליצור נסיעת המשך ללא יעד בשבצ\"ק המקור.";
  return "הפעולה לא הושלמה. יש לבדוק את פרטי השבצ\"ק והקצאות האנשים או הרכב.";
}

async function revalidateRosters(incidentId: string, rosterId?: string | null) {
  revalidatePath(`/incidents/${incidentId}/personnel`, "page");
  revalidatePath(`/incidents/${incidentId}/personnel/rosters`, "page");
  if (rosterId) {
    revalidatePath(`/incidents/${incidentId}/personnel/rosters/${rosterId}`, "page");
  }
}

function rosterIdFromData(data: unknown) {
  return data && typeof data === "object" && "roster_id" in data
    ? String((data as Record<string, unknown>).roster_id)
    : null;
}

function normalizeIsraeliMobile(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+972")) digits = `0${digits.slice(4)}`;
  digits = digits.replace(/[^0-9]/g, "");
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  return /^05\d{8}$/.test(digits) ? digits : null;
}

function roleSelection(formData: FormData) {
  const isDriver = optionalBoolean(formData, "isDriver");
  const isMovementCommander = optionalBoolean(formData, "isMovementCommander");
  const isPassenger = optionalBoolean(formData, "isPassenger");
  return { isDriver, isMovementCommander, isPassenger, hasRole: isDriver || isMovementCommander || isPassenger };
}

function sourceFromResolvedPerson(record: Record<string, unknown>) {
  if (typeof record.source_type === "string" && typeof record.existing_id === "string") {
    return { sourceType: record.source_type, sourceId: record.existing_id, reusedExisting: true };
  }
  if (typeof record.external_person_id === "string") {
    return { sourceType: "external_person", sourceId: record.external_person_id, reusedExisting: record.status === "reused" };
  }
  return null;
}

export async function createVehicleRosterAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_incident_vehicle_roster", {
    p_incident_id: incidentId,
    p_movement_type: optionalValue(formData, "movementType") ?? "outbound_to_incident",
    p_origin_text: optionalValue(formData, "originText") ?? "מחסן היחידה",
    p_destination_text: optionalValue(formData, "destinationText")
  });

  if (error) {
    logServerActionError("createVehicleRosterAction", { incidentId }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  const createdRosterId = rosterIdFromData(data);
  await revalidateRosters(incidentId, createdRosterId);
  return rosterActionResult(data, "שבצ\"ק נוצר.");
}

export async function updateVehicleRosterDraftAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const rosterId = value(formData, "rosterId");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_incident_vehicle_roster_draft", {
    p_incident_id: incidentId,
    p_roster_id: rosterId,
    p_movement_type: optionalValue(formData, "movementType"),
    p_origin_text: optionalValue(formData, "originText"),
    p_destination_text: optionalValue(formData, "destinationText"),
    p_origin_site_id: optionalValue(formData, "originSiteId"),
    p_destination_site_id: optionalValue(formData, "destinationSiteId"),
    p_planned_departure_at: optionalValue(formData, "plannedDepartureAt"),
    p_vehicle_license_plate: optionalValue(formData, "vehicleLicensePlate"),
    p_vehicle_description: optionalValue(formData, "vehicleDescription"),
    p_vehicle_type: optionalValue(formData, "vehicleType"),
    p_vehicle_notes: optionalValue(formData, "vehicleNotes"),
    p_operational_notes: optionalValue(formData, "operationalNotes")
  });

  if (error) {
    logServerActionError("updateVehicleRosterDraftAction", { incidentId, rosterId }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  await revalidateRosters(incidentId, rosterId);
  return rosterActionResult(data, "פרטי השבצ\"ק עודכנו.");
}

export async function createOrReuseRosterExternalPersonAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_or_reuse_incident_roster_external_person", {
    p_incident_id: incidentId,
    p_full_name: value(formData, "fullName"),
    p_mobile_phone: value(formData, "mobilePhone"),
    p_external_role: optionalValue(formData, "externalRole"),
    p_notes: optionalValue(formData, "notes")
  });

  if (error) {
    logServerActionError("createOrReuseRosterExternalPersonAction", { incidentId }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  await revalidateRosters(incidentId);
  return rosterActionResult(data, "גורם חיצוני נשמר לשבצ\"ק.");
}

export async function addVehicleRosterParticipantAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const rosterId = value(formData, "rosterId");
  const sourceType = value(formData, "sourceType");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("add_incident_roster_participant", {
    p_incident_id: incidentId,
    p_roster_id: rosterId,
    p_source_type: sourceType,
    p_unit_personnel_id: sourceType === "unit_personnel" ? optionalValue(formData, "sourceId") : null,
    p_manual_personnel_id: sourceType === "manual_personnel" ? optionalValue(formData, "sourceId") : null,
    p_external_person_id: sourceType === "external_person" ? optionalValue(formData, "sourceId") : null,
    p_is_driver: optionalBoolean(formData, "isDriver"),
    p_is_movement_commander: optionalBoolean(formData, "isMovementCommander"),
    p_is_passenger: optionalBoolean(formData, "isPassenger", true),
    p_notes: optionalValue(formData, "notes")
  });

  if (error) {
    logServerActionError("addVehicleRosterParticipantAction", { incidentId, rosterId, sourceType }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  await revalidateRosters(incidentId, rosterId);
  return rosterActionResult(data, "משתתף נוסף לשבצ\"ק.");
}

export async function addMultipleVehicleRosterParticipantsAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const rosterId = value(formData, "rosterId");
  const selectedPeople = formData.getAll("personKey").map(String).filter(Boolean);

  if (selectedPeople.length === 0) {
    return { error: "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05dc\u05e4\u05d7\u05d5\u05ea \u05de\u05e9\u05ea\u05ea\u05e3 \u05d0\u05d7\u05d3.", success: null, code: "missing_selection" };
  }

  const supabase = createClient();
  const results: unknown[] = [];

  for (const personKey of selectedPeople) {
    const [sourceType, sourceId] = personKey.split(":");
    const { data, error } = await supabase.rpc("add_incident_roster_participant", {
      p_incident_id: incidentId,
      p_roster_id: rosterId,
      p_source_type: sourceType,
      p_unit_personnel_id: sourceType === "unit_personnel" ? sourceId : null,
      p_manual_personnel_id: sourceType === "manual_personnel" ? sourceId : null,
      p_external_person_id: sourceType === "external_person" ? sourceId : null,
      p_is_driver: false,
      p_is_movement_commander: false,
      p_is_passenger: true,
      p_notes: optionalValue(formData, "notes")
    });

    if (error) {
      logServerActionError("addMultipleVehicleRosterParticipantsAction", { incidentId, rosterId, personKey }, error);
      return { error: friendlyPersonnelError(error), success: null, code: null, data: results };
    }

    const result = rosterActionResult(data, "המשתתף נוסף לשבצ\"ק.");
    if (result.error) {
      await revalidateRosters(incidentId, rosterId);
      return { ...result, data: results };
    }

    results.push(data);
  }

  await revalidateRosters(incidentId, rosterId);
  return { error: null, success: "המשתתפים נוספו לשבצ\"ק.", data: results };
}

export async function createExternalPersonAndAddToRosterAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const rosterId = value(formData, "rosterId");
  const fullName = value(formData, "fullName");
  const mobilePhone = value(formData, "mobilePhone");
  const normalizedPhone = normalizeIsraeliMobile(mobilePhone);
  const roles = roleSelection(formData);

  if (!fullName) {
    return { error: "יש להזין שם מלא.", success: null, code: "missing_full_name" };
  }

  if (!normalizedPhone) {
    return { error: "יש להזין מספר טלפון נייד תקין, לדוגמה 050-1234567.", success: null, code: "invalid_mobile_phone" };
  }

  if (!roles.hasRole) {
    return { error: "יש לבחור לפחות תפקיד אחד.", success: null, code: "missing_role" };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_or_reuse_incident_roster_external_person", {
    p_incident_id: incidentId,
    p_full_name: fullName,
    p_mobile_phone: mobilePhone,
    p_external_role: optionalValue(formData, "externalRole"),
    p_notes: optionalValue(formData, "notes")
  });

  if (error) {
    logServerActionError("createExternalPersonAndAddToRosterAction:create", { incidentId, rosterId }, error);
    return { error: "לא ניתן היה להוסיף את הגורם החיצוני. נסה שוב.", success: null, code: null };
  }

  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const resolved = sourceFromResolvedPerson(record);

  if (!resolved) {
    logServerActionError("createExternalPersonAndAddToRosterAction:resolve", { incidentId, rosterId, data }, new Error("Could not resolve roster person source"));
    return { error: "לא ניתן היה לזהות את האדם שנמצא. נסה לבחור אותו מהרשימה.", success: null, code: "unresolved_person", data };
  }

  const { data: addData, error: addError } = await supabase.rpc("add_incident_roster_participant", {
    p_incident_id: incidentId,
    p_roster_id: rosterId,
    p_source_type: resolved.sourceType,
    p_unit_personnel_id: resolved.sourceType === "unit_personnel" ? resolved.sourceId : null,
    p_manual_personnel_id: resolved.sourceType === "manual_personnel" ? resolved.sourceId : null,
    p_external_person_id: resolved.sourceType === "external_person" ? resolved.sourceId : null,
    p_is_driver: roles.isDriver,
    p_is_movement_commander: roles.isMovementCommander,
    p_is_passenger: roles.isPassenger,
    p_notes: optionalValue(formData, "notes")
  });

  if (addError) {
    logServerActionError("createExternalPersonAndAddToRosterAction:add", { incidentId, rosterId, sourceType: resolved.sourceType, sourceId: resolved.sourceId }, addError);
    return { error: friendlyPersonnelError(addError), success: null, code: null, data };
  }

  const addResult = rosterActionResult(addData, "");
  if (addResult.error) {
    await revalidateRosters(incidentId, rosterId);
    return { ...addResult, data: { resolved, addData } };
  }

  await revalidateRosters(incidentId, rosterId);
  const message = resolved.reusedExisting
    ? "נמצא אדם קיים עם מספר טלפון זה והוא נוסף לשבצ\"ק."
    : "הגורם החיצוני נוסף לשבצ\"ק בהצלחה.";
  return { error: null, success: message, data: { resolved, addData } };
}

export async function updateVehicleRosterParticipantRolesAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const rosterId = optionalValue(formData, "rosterId");
  const participantId = value(formData, "participantId");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_incident_roster_participant_roles", {
    p_incident_id: incidentId,
    p_participant_id: participantId,
    p_is_driver: optionalBoolean(formData, "isDriver"),
    p_is_movement_commander: optionalBoolean(formData, "isMovementCommander"),
    p_is_passenger: optionalBoolean(formData, "isPassenger")
  });

  if (error) {
    logServerActionError("updateVehicleRosterParticipantRolesAction", { incidentId, participantId }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  await revalidateRosters(incidentId, rosterId);
  return rosterActionResult(data, "תפקידי המשתתף עודכנו.");
}

export async function removeVehicleRosterParticipantAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const rosterId = optionalValue(formData, "rosterId");
  const participantId = value(formData, "participantId");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("remove_incident_roster_participant", {
    p_incident_id: incidentId,
    p_participant_id: participantId
  });

  if (error) {
    logServerActionError("removeVehicleRosterParticipantAction", { incidentId, participantId }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  await revalidateRosters(incidentId, rosterId);
  return rosterActionResult(data, "משתתף הוסר מהשבצ\"ק.");
}

export async function transitionVehicleRosterAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const rosterId = value(formData, "rosterId");
  const targetStatus = value(formData, "targetStatus");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("transition_incident_vehicle_roster", {
    p_incident_id: incidentId,
    p_roster_id: rosterId,
    p_target_status: targetStatus,
    p_operational_timestamp: optionalValue(formData, "operationalTimestamp"),
    p_reason: optionalValue(formData, "reason")
  });

  if (error) {
    logServerActionError("transitionVehicleRosterAction", { incidentId, rosterId, targetStatus }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  await revalidateRosters(incidentId, rosterId);
  return rosterActionResult(data, "סטטוס השבצ\"ק עודכן.");
}

export async function cloneVehicleRosterForReturnAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const sourceRosterId = value(formData, "sourceRosterId");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clone_incident_vehicle_roster_for_return", {
    p_incident_id: incidentId,
    p_source_roster_id: sourceRosterId,
    p_planned_departure_at: optionalValue(formData, "plannedDepartureAt")
  });

  if (error) {
    logServerActionError("cloneVehicleRosterForReturnAction", { incidentId, sourceRosterId }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  const newRosterId = rosterIdFromData(data);
  await revalidateRosters(incidentId, sourceRosterId);
  await revalidateRosters(incidentId, newRosterId);
  return rosterActionResult(data, "שבצ\"ק חזור נוצר.");
}

export async function cloneVehicleRosterForNextDestinationAction(
  _prevState: VehicleRosterActionState,
  formData: FormData
): Promise<VehicleRosterActionState> {
  const incidentId = value(formData, "incidentId");
  const sourceRosterId = value(formData, "sourceRosterId");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clone_incident_vehicle_roster_for_next_destination", {
    p_incident_id: incidentId,
    p_source_roster_id: sourceRosterId,
    p_planned_departure_at: optionalValue(formData, "plannedDepartureAt")
  });

  if (error) {
    logServerActionError("cloneVehicleRosterForNextDestinationAction", { incidentId, sourceRosterId }, error);
    return { error: friendlyPersonnelError(error), success: null, code: null };
  }

  const newRosterId = rosterIdFromData(data);
  await revalidateRosters(incidentId, sourceRosterId);
  await revalidateRosters(incidentId, newRosterId);
  return rosterActionResult(data, "שבצ\"ק המשך נוצר.");
}
export async function listVehicleRostersForIncident(incidentId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_incident_vehicle_rosters", {
    p_incident_id: incidentId
  });

  if (error) {
    logServerActionError("listVehicleRostersForIncident", { incidentId }, error);
    return [];
  }

  return data ?? [];
}

export async function getVehicleRosterForIncident(incidentId: string, rosterId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_incident_vehicle_roster", {
    p_incident_id: incidentId,
    p_roster_id: rosterId
  });

  if (error) {
    logServerActionError("getVehicleRosterForIncident", { incidentId, rosterId }, error);
    return null;
  }

  return data ?? null;
}

export async function listRosterEligiblePeople(incidentId: string, currentRosterId?: string | null) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_incident_roster_eligible_people", {
    p_incident_id: incidentId,
    p_current_roster_id: currentRosterId ?? null
  });

  if (error) {
    logServerActionError("listRosterEligiblePeople", { incidentId, currentRosterId }, error);
    return [];
  }

  return data ?? [];
}
