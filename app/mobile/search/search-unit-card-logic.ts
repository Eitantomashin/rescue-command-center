export const RESIDENT_CASUALTY_STATUSES = new Set(["anxiety_casualty", "physical_casualty", "deceased"]);
const CARD_RESIDENT_STATUS_KEYS = new Set(["not_checked", "resident_clear", "anxiety_casualty", "physical_casualty", "deceased"]);
export type CardResident = { id?: string; first_name: string; last_name: string; age: string; phone: string; notes: string; gender: "unknown" | "male" | "female"; status_key: string; requires_evacuation: boolean; evacuated_at?: string | null };
export function knownPeopleCount(value: string) { if (value === "") return null; const count = Number(value); return Number.isInteger(count) && count >= 0 && count <= 10 ? count : null; }
export function hasResidentCasualty(statuses: string[]) { return statuses.some((status) => RESIDENT_CASUALTY_STATUSES.has(status)); }
export function canClearSearchUnit(count: number | null, statuses: string[], hadCasualties: boolean) { return !hadCasualties && count !== null && (count === 0 || (statuses.length === count && statuses.every((status) => status === "resident_clear"))); }
export function residentIdsLeavingActiveList<T extends { id?: string }>(residents: T[], count: number | null) { return count === null ? [] : residents.slice(count).flatMap((resident) => resident.id ? [resident.id] : []); }
export function residentSubmission<T extends { id?: string }>(residents: T[], count: number | null) {
  if (count === null) return { residents, deactivateResidentIds: [] as string[] };
  const submittedResidents = residents.slice(0, count);
  return { residents: submittedResidents, deactivateResidentIds: residentIdsLeavingActiveList(residents, count) };
}
export function requiresResidentDecreaseConfirmation(residents: Array<{ id?: string; first_name: string; last_name: string; notes: string; status_key: string }>, count: number) { return residents.slice(count).some((resident) => Boolean(resident.id) && Boolean(resident.first_name || resident.last_name || resident.notes || resident.status_key !== "not_checked")); }
export function normalizeResidentStatus(status: string | null | undefined, requiresEvacuation = false) { return status === "medical_evacuation" ? { status_key: "physical_casualty", requires_evacuation: true } : { status_key: status ?? "not_checked", requires_evacuation: requiresEvacuation }; }
export function residentStatusKeyFromEmbeddedStatus(statusTypes: unknown) {
  if (!statusTypes || typeof statusTypes !== "object" || Array.isArray(statusTypes)) return "not_checked";
  const statusKey = (statusTypes as { status_key?: unknown }).status_key;
  return typeof statusKey === "string" && CARD_RESIDENT_STATUS_KEYS.has(statusKey) ? statusKey : "not_checked";
}
export function residentSummary(residents: CardResident[]) { return residents.reduce((summary, resident) => { summary.total += 1; if (resident.status_key === "resident_clear") summary.clear += 1; if (resident.status_key === "anxiety_casualty") summary.anxiety += 1; if (resident.status_key === "physical_casualty") summary.physical += 1; if (resident.status_key === "deceased") summary.deceased += 1; if (RESIDENT_CASUALTY_STATUSES.has(resident.status_key) && resident.requires_evacuation) summary.evacuation += 1; return summary; }, { total: 0, clear: 0, anxiety: 0, physical: 0, deceased: 0, evacuation: 0 }); }
