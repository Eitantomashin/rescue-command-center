import { equipmentTiming, equipmentWarning, groupEquipment, teamLabel, type Equipment, type EquipmentAction, type Team } from "./equipment-model";

export type ViewMode = "compact" | "detailed";
export type SortMode = "exceptions" | "team" | "name" | "remaining";
export type FocusFilter = "all" | "warning" | "overdue" | "running" | "paused" | "off" | "serviceability" | "exceptions";
export const viewStorageKey = "equipment-view-mode";
export function readViewMode(storage: Pick<Storage, "getItem">): ViewMode {
  try { return storage.getItem(viewStorageKey) === "detailed" ? "detailed" : "compact"; } catch { return "compact"; }
}
export function saveViewMode(storage: Pick<Storage, "setItem">, mode: ViewMode) {
  try { storage.setItem(viewStorageKey, mode); } catch { /* Optional preference only. */ }
}
// Existing operational team-number convention (incident wizard and operational-teams.ts).
// These classify actual rows; no destination is synthesized from a name or number.
export function teamCategory(number?: number | null, adHoc = false) {
  if (adHoc) return "צוותי אד־הוק";
  if (number === 93) return "חפ״ק";
  if (number === 9) return "אוכלוסייה";
  if (number === 91 || number === 92) return "צוותים מקצועיים";
  if (number != null && number >= 20) return "צוותים נוספים";
  return "צוותי חילוץ או סריקה";
}
export function teamOptionsByCategory(teams: Team[]) {
  const groups = new Map<string, Team[]>();
  for (const team of teams) {
    const category = team.category ?? (team.key.startsWith("ad_hoc:") ? "צוותי אד־הוק" : "צוותי חילוץ או סריקה");
    groups.set(category, [...(groups.get(category) ?? []), team]);
  }
  return Array.from(groups, ([label, options]) => ({ label, options }));
}
export function controlState(row: Equipment, now: number | null) {
  if (now === null) return { tone: "neutral", label: "מסתנכרן", remaining: null, fuel: 0, rank: 2 };
  const timing = equipmentTiming(row, now);
  if (!Number.isFinite(timing.remaining)) return { tone: "neutral", label: "מצב זמן לא תקין", remaining: null, fuel: 0, rank: 2 };
  const unstarted = !row.first_started_at;
  const rank = !unstarted && timing.state === "overdue" ? 0 : !unstarted && timing.state === "warning" ? 1
    : equipmentWarning(row) ? 2 : row.operation_state === "running" ? 3 : row.operation_state === "paused" ? 4 : 5;
  return { tone: row.operation_state === "off" && unstarted ? "neutral" : unstarted ? "normal" : timing.state,
    label: row.operation_state === "off" && unstarted ? "כבוי" : unstarted || timing.state === "normal" ? "תקין"
      : timing.state === "warning" ? "נדרש תדלוק" : "זמן עבודה הסתיים",
    remaining: timing.remaining, fuel: Math.max(0, Math.min(100, 100 - timing.progress)), rank };
}
export function matchesFocus(row: Equipment, now: number | null, filter: FocusFilter) {
  const state = controlState(row, now);
  if (filter === "all") return true;
  if (filter === "exceptions") return state.rank <= 2;
  if (filter === "warning") return state.rank === 1;
  if (filter === "overdue") return state.rank === 0;
  if (filter === "serviceability") return !!equipmentWarning(row);
  return row.operation_state === filter;
}
export const summaryFilters: { key: FocusFilter; label: string }[] = [
  { key: "warning", label: "דורשים תדלוק" }, { key: "overdue", label: "בחריגה" },
  { key: "running", label: "פועלים" }, { key: "paused", label: "מושהים" },
  { key: "off", label: "כבויים" }, { key: "serviceability", label: "אזהרות כשירות" }
];
export function primaryAction(row: Equipment): EquipmentAction {
  return row.operation_state === "running" ? "pause" : row.operation_state === "paused" ? "resume" : "start";
}
export function sortEquipment(rows: Equipment[], now: number | null, mode: SortMode) {
  const remaining = (row: Equipment) => controlState(row, now).remaining ?? Infinity;
  return rows.slice().sort((a, b) => {
    const leading = mode === "exceptions" ? controlState(a, now).rank - controlState(b, now).rank
      : mode === "team" ? teamLabel(a).localeCompare(teamLabel(b), "he")
      : mode === "name" ? a.asset_identifier_snapshot.localeCompare(b.asset_identifier_snapshot, "he", { numeric: true }) : 0;
    return leading || remaining(a) - remaining(b)
      || a.asset_identifier_snapshot.localeCompare(b.asset_identifier_snapshot, "he", { numeric: true })
      || a.assignment_id.localeCompare(b.assignment_id);
  });
}
// Cache order by server snapshot + severity category, not by the one-second clock.
// Values are refreshed every render while keyed cards keep their position/state.
export function createEquipmentOrdering() {
  let stamp = ""; let order: string[] = []; let groupOrder: string[] = [];
  return (rows: Equipment[], now: number | null, mode: SortMode, snapshot: string) => {
    const next = `${mode}:${snapshot}:${rows.map((r) => `${r.assignment_id}:${r.version}:${r.team_id}:${r.ad_hoc_team_id}:${controlState(r, now).rank}`).join("|")}`;
    if (next !== stamp) {
      stamp = next;
      const sorted = sortEquipment(rows, now, mode);
      const groups = groupEquipment(sorted);
      if (mode === "team") groups.sort((a, b) => a.label.localeCompare(b.label, "he"));
      if (mode === "exceptions") {
        const priority = (items: Equipment[]) => items.some((r) => controlState(r, now).rank === 0) ? 0
          : items.some((r) => controlState(r, now).rank === 1) ? 1 : items.some((r) => r.operation_state === "running") ? 2 : 3;
        groups.sort((a, b) => priority(a.rows) - priority(b.rows));
      }
      order = sorted.map((r) => r.assignment_id); groupOrder = groups.map((g) => g.key);
    }
    const byId = new Map(rows.map((r) => [r.assignment_id, r]));
    const groups = groupEquipment(order.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []));
    return groups.sort((a, b) => groupOrder.indexOf(a.key) - groupOrder.indexOf(b.key));
  };
}
export function createEquipmentRowOrdering() {
  let stamp = ""; let order: string[] = [];
  return (rows: Equipment[], now: number | null, snapshot: string) => {
    const next = `${snapshot}:${rows.map((r) => `${r.assignment_id}:${r.version}:${controlState(r, now).rank}`).join("|")}`;
    if (next !== stamp) { stamp = next; order = sortEquipment(rows, now, "exceptions").map((row) => row.assignment_id); }
    const byId = new Map(rows.map((row) => [row.assignment_id, row]));
    return order.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
  };
}
export function defaultEquipmentTab(rows: Equipment[]) {
  return rows.length ? "equipment" : "events";
}
export function equipmentHref(incidentId: string, assignmentId: string) {
  return `/incidents/${encodeURIComponent(incidentId)}/equipment?assignment=${encodeURIComponent(assignmentId)}`;
}
