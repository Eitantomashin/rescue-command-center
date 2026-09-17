"use server";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "./equipment-validation";
import type { AlertResult, AlertSnapshot, AlertClaim, Delivery } from "./alert-model";

async function call<T>(rpc: string, incidentId: string, token?: string, alertId?: string): Promise<AlertResult<T>> {
  try {
    const payload: Record<string, string> = { p_incident_id: uuid(incidentId) };
    if (rpc !== "sync_equipment_alerts") payload.p_presentation_token = uuid(token);
    if (rpc === "ack_equipment_alert_presented" || rpc === "dismiss_equipment_alert") payload.p_alert_id = uuid(alertId);
    const client = createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (!user || authError) return { ok: false, stopped: true, message: "יש להתחבר כמשתמש מורשה כדי לקבל התרעות ציוד." };
    const [read, edit, role] = await Promise.all([
      client.rpc("can_read_equipment_incident", { p_incident_id: incidentId }),
      client.rpc("can_edit_operational_data", { p_incident_id: incidentId }), client.rpc("current_user_role")
    ]);
    if (read.error || read.data !== true || edit.error || edit.data !== true || role.error || !["admin", "commander", "editor"].includes(role.data)) {
      return { ok: false, stopped: true, message: "אין הרשאה לתפעול התרעות באירוע זה." };
    }
    const { data, error } = await client.rpc(rpc, payload);
    if (error) return { ok: false, stopped: ["42501", "55000"].includes(error.code),
      message: ["42501", "55000"].includes(error.code) ? "ההתרעה או ההצגה אינן זמינות עוד. המצב יסונכרן מחדש."
        : "סנכרון ההתרעות נכשל. יתבצע ניסיון נוסף; לא אושרה דחייה." };
    if (!data || typeof data !== "object") return { ok: false, message: "לא התקבלה תשובה תקינה עבור ההתרעות." };
    return { ok: true, data: data as T };
  } catch { return { ok: false, message: "לא ניתן להשלים את פעולת ההתרעה. יש לבדוק את החיבור." }; }
}
export async function syncEquipmentAlerts(incidentId: string) {
  return call<AlertSnapshot>("sync_equipment_alerts", incidentId);
}
export async function claimEquipmentAlerts(incidentId: string, token: string) {
  return call<AlertClaim>("claim_equipment_alerts", incidentId, token);
}
export async function ackEquipmentAlert(incidentId: string, alertId: string, token: string) {
  return call<Delivery>("ack_equipment_alert_presented", incidentId, token, alertId);
}
export async function dismissEquipmentAlert(incidentId: string, alertId: string, token: string) {
  return call<Delivery>("dismiss_equipment_alert", incidentId, token, alertId);
}
