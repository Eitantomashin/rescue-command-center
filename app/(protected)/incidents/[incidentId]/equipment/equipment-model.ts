export type OperationState = "off" | "running" | "paused";
export type TimeState = "normal" | "warning" | "overdue";
export type EquipmentAction = "assign" | "update" | "transfer" | "release" | "start" | "pause" | "resume" | "refuel";
export type IncidentState = { lifecycle_status: string | null; is_closed: boolean; archived_at: string | null };
export type Equipment = {
  assignment_id: string; equipment_item_id: string; version: number; cycle_id: string;
  operation_state: OperationState; accumulated_active_seconds: number; running_since: string | null;
  first_started_at: string | null; full_runtime_seconds_snapshot: number; warning_before_seconds_snapshot: number;
  asset_identifier_snapshot: string; serial_number?: string | null; equipment_type_id_snapshot: string;
  equipment_type_name_snapshot: string; instructions_snapshot: string | null;
  team_id: string | null; ad_hoc_team_id: string | null; team_name: string | null;
  location: string | null; notes: string | null;
  equipment_item_is_active: boolean; equipment_type_is_active: boolean;
  serviceability: "serviceable" | "restricted" | "unserviceable";
};
export type AvailableEquipment = {
  equipment_item_id: string; asset_identifier: string; serial_number: string | null;
  equipment_type_id: string; equipment_type_name: string; full_runtime_seconds: number; warning_before_seconds: number;
};
export type Team = { key: string; label: string };
export type EquipmentData = {
  server_now: string; equipment: Equipment[]; incident: IncidentState & { name: string };
  canEdit: boolean; teams: Team[]; available: AvailableEquipment[]; availabilityError: string | null;
};
export type ActionResult = { ok: boolean; message: string; refresh?: boolean };
export type ReadResult = { ok: true; data: EquipmentData } | { ok: false; message: string; denied?: boolean };
export const operationLabels: Record<OperationState, string> = { off: "כבוי", running: "פועל", paused: "מושהה" };
export const timeLabels: Record<TimeState, string> = { normal: "תקין", warning: "בטווח התרעה", overdue: "חריגה — זמן העבודה הסתיים" };
export const actionLabels: Record<EquipmentAction, string> = {
  assign: "הקצה ציוד", update: "שמור מיקום והערות", transfer: "העבר צוות", release: "שחרר ציוד",
  start: "הפעל", pause: "השהה", resume: "המשך הפעלה", refuel: "בוצע תדלוק"
};
export const REFUEL_CONFIRMATION = "האם לאשר שבוצע תדלוק?";
export function canOperate(incident: IncidentState, canEdit: boolean) {
  return canEdit && !incident.is_closed && !incident.archived_at && ["active", "paused"].includes(incident.lifecycle_status ?? "");
}
export function canAssign(incident: IncidentState, canEdit: boolean) {
  return canOperate(incident, canEdit) && incident.lifecycle_status === "active";
}
export function allowedActions(row: Equipment, incident: IncidentState, canEdit: boolean): EquipmentAction[] {
  if (!canOperate(incident, canEdit)) return [];
  const actions: EquipmentAction[] = ["update", "transfer"];
  if (row.operation_state === "off") actions.push("start", "release");
  if (row.operation_state === "running") actions.push("pause");
  if (row.operation_state === "paused") actions.push("resume", "release");
  // The installed RPC rejects refuel of a fresh, unstarted refueled cycle.
  if (row.operation_state !== "off" && row.first_started_at) actions.push("refuel");
  return actions;
}
export function estimateServerTime(serverNow: string, receivedAt: number, monotonicNow: number) {
  return Date.parse(serverNow) + Math.max(0, monotonicNow - receivedAt);
}
export function equipmentTiming(row: Equipment, estimatedServerTime: number) {
  const elapsed = Number(row.accumulated_active_seconds) + (row.operation_state === "running" && row.running_since
    ? (estimatedServerTime - Date.parse(row.running_since)) / 1000 : 0);
  const remaining = row.full_runtime_seconds_snapshot - elapsed;
  const state: TimeState = remaining <= 0 ? "overdue" : remaining <= row.warning_before_seconds_snapshot ? "warning" : "normal";
  const progress = Math.max(0, Math.min(100, 100 * elapsed / row.full_runtime_seconds_snapshot));
  return { elapsed, remaining, state, progress };
}
export function duration(seconds: number) {
  const total = Math.floor(Math.abs(seconds));
  const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  return `${seconds < 0 ? "-" : ""}${parts.map((part) => String(part).padStart(2, "0")).join(":")}`;
}
export function equipmentWarning(row: Equipment) {
  const warnings: string[] = [];
  if (!row.equipment_item_is_active) warnings.push("הפריט מושבת");
  if (!row.equipment_type_is_active) warnings.push("סוג הציוד מושבת");
  if (row.serviceability === "restricted") warnings.push("כשירות מוגבלת");
  if (row.serviceability === "unserviceable") warnings.push("הפריט לא כשיר");
  return warnings.length ? `${warnings.join(" · ")}. נדרשת תשומת לב תפעולית; השעון ממשיך לפי מצב ההפעלה.` : null;
}
export function teamKey(row: Equipment) {
  if (!row.team_name) return "none";
  return row.team_id ? `regular:${row.team_id}` : row.ad_hoc_team_id ? `ad_hoc:${row.ad_hoc_team_id}` : "none";
}
export function teamLabel(row: Equipment) {
  return teamKey(row) === "none" ? "ללא צוות" : `${row.team_name} · ${row.team_id ? "צוות רגיל" : "צוות אד־הוק"}`;
}
export type Filters = { query: string; team: string; type: string; operation: string; time: string };
export const emptyFilters: Filters = { query: "", team: "", type: "", operation: "", time: "" };
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("he");
export function filterEquipment(rows: Equipment[], filters: Filters, serverTime: number | null) {
  return rows.filter((row) => (!filters.query || normalize(`${row.asset_identifier_snapshot} ${row.serial_number ?? ""}`).includes(normalize(filters.query)))
    && (!filters.team || teamKey(row) === filters.team) && (!filters.type || row.equipment_type_id_snapshot === filters.type)
    && (!filters.operation || row.operation_state === filters.operation)
    && (!filters.time || (serverTime !== null && equipmentTiming(row, serverTime).state === filters.time)));
}
export function groupEquipment(rows: Equipment[]) {
  const groups = new Map<string, { key: string; label: string; rows: Equipment[] }>();
  for (const row of rows) {
    const key = teamKey(row);
    if (!groups.has(key)) groups.set(key, { key, label: teamLabel(row), rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return Array.from(groups.values());
}
// A synchronous guard closes the gap before React renders the disabled button.
export function createSubmissionGate() {
  let busy = false;
  return { enter: () => { if (busy) return false; busy = true; return true; }, leave: () => { busy = false; } };
}
