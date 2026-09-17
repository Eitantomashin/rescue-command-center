"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { actionPayload, actionRpcs, rpcError, uuid } from "./equipment-validation";
import { canAssign, canOperate, type ActionResult, type AvailableEquipment, type Equipment, type EquipmentAction, type ReadResult, type Team } from "./equipment-model";

async function access(incidentId: string) {
  uuid(incidentId);
  const client = createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const { data: readable, error: readError } = await client.rpc("can_read_equipment_incident", { p_incident_id: incidentId });
  if (readError || readable !== true) return null;
  const [incidentResult, editResult, roleResult] = await Promise.all([
    client.from("incidents").select("name,lifecycle_status,is_closed,archived_at").eq("id", incidentId).maybeSingle(),
    client.rpc("can_edit_operational_data", { p_incident_id: incidentId }),
    client.rpc("current_user_role")
  ]);
  if (incidentResult.error || !incidentResult.data) return null;
  return { client, incident: incidentResult.data, canEdit: !editResult.error && editResult.data === true
    && !roleResult.error && ["admin", "commander", "editor"].includes(roleResult.data) };
}

export async function readEquipment(incidentId: string): Promise<ReadResult> {
  try {
    const context = await access(incidentId);
    if (!context) return { ok: false, denied: true, message: "אין הרשאה לצפות בציוד באירוע זה." };
    const { client, incident, canEdit } = context;
    const teams: Team[] = [];
    if (canOperate(incident, canEdit)) {
      // Explicit pagination avoids silently hiding teams beyond the API row limit.
      for (const kind of ["regular", "ad_hoc"] as const) {
        for (let offset = 0; ; offset += 500) {
          const query = kind === "regular"
            ? client.from("teams").select("id,name,team_number").eq("is_active", true)
            : client.from("incident_ad_hoc_teams").select("id,name").eq("status", "active").is("archived_at", null);
          const { data, error } = await query.eq("incident_id", incidentId).order("id").range(offset, offset + 499);
          if (error) return { ok: false, message: "לא ניתן לטעון את צוותי האירוע. יש לנסות לרענן." };
          for (const row of data ?? []) teams.push({ key: `${kind}:${row.id}`,
            label: `${row.name || ("team_number" in row ? `צוות ${row.team_number}` : "צוות")} · ${kind === "regular" ? "צוות רגיל" : "צוות אד־הוק"}` });
          if (!data || data.length < 500) break;
        }
      }
    }
    let available: AvailableEquipment[] = [];
    let availabilityError: string | null = null;
    if (canAssign(incident, canEdit)) {
      const result = await client.rpc("get_available_equipment_for_incident", { p_incident_id: incidentId });
      if (result.error || !Array.isArray(result.data)) availabilityError = "לא ניתן לטעון ציוד פנוי. יש לרענן לפני הקצאה.";
      else available = result.data as AvailableEquipment[];
    }
    // Last query: keep the clock sample as close as possible to delivery.
    const { data, error } = await client.rpc("get_incident_equipment_state", { p_incident_id: incidentId });
    if (error || !data || !Array.isArray(data.equipment) || !Number.isFinite(Date.parse(data.server_now))) {
      return { ok: false, message: "לא ניתן לטעון את מצב הציוד מהשרת. יש לנסות לרענן." };
    }
    return { ok: true, data: { server_now: data.server_now, equipment: data.equipment as Equipment[], incident, canEdit, teams, available, availabilityError } };
  } catch {
    return { ok: false, message: "טעינת הציוד נכשלה. יש לבדוק את החיבור ולנסות שוב." };
  }
}

async function mutate(action: EquipmentAction, form: FormData): Promise<ActionResult> {
  let payload: Record<string, unknown>;
  try { payload = actionPayload(action, form); }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "יש לבדוק את פרטי הטופס." }; }
  try {
    const incidentId = payload.p_incident_id as string;
    const context = await access(incidentId);
    if (!context || !context.canEdit) return { ok: false, message: rpcError({ code: "42501" }), refresh: true };
    if (!(action === "assign" ? canAssign(context.incident, context.canEdit) : canOperate(context.incident, context.canEdit))) {
      return { ok: false, message: rpcError({ code: "55000" }), refresh: true };
    }
    // Database RPC repeats authorization and lifecycle/version checks under locks.
    const { data, error } = await context.client.rpc(actionRpcs[action], payload);
    if (error) return { ok: false, message: rpcError(error), refresh: true };
    if (!data?.assignment_id || !data?.version) return { ok: false, message: rpcError({}), refresh: true };
    const base = `/incidents/${incidentId}`;
    for (const path of [`${base}/equipment`, base, `${base}/timeline`, `${base}/operational-log`]) revalidatePath(path);
    return { ok: true, message: action === "refuel" ? "התדלוק אושר. הציוד מושהה ומוכן להמשך הפעלה מפורש."
      : action === "release" ? "הציוד שוחרר מהאירוע." : action === "assign" ? "הציוד הוקצה כשהוא כבוי ובזמן מלא." : "הפעולה בוצעה בהצלחה." };
  } catch { return { ok: false, message: rpcError({}), refresh: true }; }
}
export async function assignEquipment(form: FormData) { return mutate("assign", form); }
export async function updateEquipmentAssignment(form: FormData) { return mutate("update", form); }
export async function transferEquipment(form: FormData) { return mutate("transfer", form); }
export async function releaseEquipment(form: FormData) { return mutate("release", form); }
export async function startEquipment(form: FormData) { return mutate("start", form); }
export async function pauseEquipment(form: FormData) { return mutate("pause", form); }
export async function resumeEquipment(form: FormData) { return mutate("resume", form); }
export async function confirmEquipmentRefuel(form: FormData) { return mutate("refuel", form); }
