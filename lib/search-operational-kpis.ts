import {
  hasSearchApartmentDamage,
  isClearedSearchUnit,
  isOpenSearchCasualtyUnit,
  isResolvedSearchCasualtyUnit,
  searchProcessCategory,
  type SearchUnitStatus
} from "@/lib/search-site-status";
import { searchMedicalEvacuationState, type SearchCasualtyPerson } from "@/lib/search-casualty-person";

export type SearchOperationalUnit = {
  unitId: string;
  floorNumber: number | null;
  unitLabel: string;
  status: SearchUnitStatus;
  casualtiesResolved: boolean;
  hasApartmentDamage: boolean;
  apartmentDamageNotes: string | null;
};

export function searchOperationalKpiCollections<T extends SearchOperationalUnit>(units: T[], people: SearchCasualtyPerson[]) {
  const byProcess = {
    total: units,
    notStarted: units.filter((unit) => searchProcessCategory(unit.status) === "not_visited"),
    inProgress: units.filter((unit) => searchProcessCategory(unit.status) === "in_progress"),
    noAnswer: units.filter((unit) => searchProcessCategory(unit.status) === "no_answer"),
    completed: units.filter((unit) => searchProcessCategory(unit.status) === "completed")
  };
  return {
    process: byProcess,
    findings: {
      cleared: units.filter((unit) => isClearedSearchUnit(unit.status)),
      damaged: units.filter((unit) => hasSearchApartmentDamage(unit.hasApartmentDamage)),
      openCasualties: units.filter((unit) => isOpenSearchCasualtyUnit(unit.status, unit.casualtiesResolved)),
      resolvedCasualties: units.filter((unit) => isResolvedSearchCasualtyUnit(unit.status, unit.casualtiesResolved)),
      anxiety: people.filter((person) => person.status === "anxiety_casualty"),
      physical: people.filter((person) => person.status === "physical_casualty"),
      deceased: people.filter((person) => person.status === "deceased"),
      waitingEvacuation: people.filter((person) => searchMedicalEvacuationState(person) === "waiting")
    }
  };
}
