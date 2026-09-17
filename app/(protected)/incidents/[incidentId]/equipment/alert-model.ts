import type { Equipment } from "./equipment-model";
export type Severity = "warning" | "critical";
export type EquipmentAlert = Equipment & { incident_id: string; alert_id: string; severity: Severity; detected_at: string; server_now: string };
export type Delivery = { alert_id: string; presentation_token: string | null; lease_until: string | null;
  presentation_acknowledged: boolean; next_due_at: string | null; dismissed_at: string | null; claimed_severity: Severity | null };
export type ClaimedAlert = EquipmentAlert & { presentation_token: string; lease_until: string; claimed_severity: Severity };
export type AlertSnapshot = { server_now: string; alerts: EquipmentAlert[]; presentations: Delivery[] };
export type AlertClaim = { server_now: string; alerts: ClaimedAlert[] };
export type AlertResult<T> = { ok: true; data: T } | { ok: false; message: string; stopped?: boolean };
export type Presentation = { alert: EquipmentAlert; token: string; expiresAt: number; acknowledged: boolean; claimedSeverity: Severity };
export const ALERT_POLL_MS = 25000;
export const alertLabels: Record<Severity, string> = { warning: "נדרש תדלוק", critical: "זמן העבודה הסתיים" };
export const presentationKey = (p: Presentation) => `${p.alert.alert_id}:${p.token}`;
export function sortPresentations(rows: Presentation[]) {
  return rows.slice().sort((a, b) => (a.alert.severity === "critical" ? 0 : 1) - (b.alert.severity === "critical" ? 0 : 1)
    || Date.parse(a.alert.detected_at) - Date.parse(b.alert.detected_at) || a.alert.alert_id.localeCompare(b.alert.alert_id));
}
export function reconcilePresentations(rows: Presentation[], state: AlertSnapshot) {
  const now = Date.parse(state.server_now);
  return rows.flatMap((row) => {
    const alert = state.alerts.find((a) => a.alert_id === row.alert.alert_id && a.cycle_id === row.alert.cycle_id);
    const own = state.presentations.find((d) => d.alert_id === row.alert.alert_id && d.presentation_token === row.token);
    if (!alert || !own || own.dismissed_at) return [];
    const expiresAt = Date.parse((own.presentation_acknowledged ? own.next_due_at : own.lease_until) ?? "");
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return [];
    // Reclaim critical with a NEW token; never extend or steal a live lease.
    if (own.presentation_acknowledged && alert.severity === "critical" && own.claimed_severity !== "critical") return [];
    return [{ ...row, alert, expiresAt, acknowledged: own.presentation_acknowledged }];
  });
}
