export const SEARCH_CASUALTY_PERSON_STATUSES = ["anxiety_casualty", "physical_casualty", "deceased"] as const;

export type SearchCasualtyPersonStatus = (typeof SEARCH_CASUALTY_PERSON_STATUSES)[number];

export type SearchCasualtyPerson = {
  residentId: string;
  unitId: string;
  floorNumber: number | null;
  unitNumber: string;
  firstName: string;
  lastName: string | null;
  status: SearchCasualtyPersonStatus;
  requiresMedicalEvacuation: boolean;
  evacuatedAt?: string | null;
  casualtiesResolved: boolean;
};

export type SearchMedicalEvacuationState = "not_required" | "waiting" | "evacuated";

export function isSearchCasualtyPersonStatus(status: unknown): status is SearchCasualtyPersonStatus {
  return typeof status === "string" && (SEARCH_CASUALTY_PERSON_STATUSES as readonly string[]).includes(status);
}

export function isActiveSearchCasualtyPerson(row: { isActive: boolean; status: unknown }) {
  return row.isActive && isSearchCasualtyPersonStatus(row.status);
}

export function searchCasualtyPersonStatusLabel(status: SearchCasualtyPersonStatus) {
  return status === "anxiety_casualty" ? "נפגע חרדה" : status === "physical_casualty" ? "נפגע גוף" : "חלל";
}

export function searchCasualtyPersonTreatmentLabel(casualtiesResolved: boolean) {
  return casualtiesResolved ? "הטיפול הסתיים" : "טיפול פתוח";
}

export function searchMedicalEvacuationState(person: Pick<SearchCasualtyPerson, "status" | "requiresMedicalEvacuation" | "evacuatedAt">): SearchMedicalEvacuationState {
  if (person.status !== "physical_casualty" || !person.requiresMedicalEvacuation) return "not_required";
  return person.evacuatedAt ? "evacuated" : "waiting";
}

export function formatSearchEvacuatedAt(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function searchCasualtyPersonCounts(people: SearchCasualtyPerson[]) {
  return people.reduce((counts, person) => {
    if (person.status === "anxiety_casualty") counts.anxiety += 1;
    else if (person.status === "physical_casualty") counts.physical += 1;
    else counts.deceased += 1;
    return counts;
  }, { anxiety: 0, physical: 0, deceased: 0 });
}
