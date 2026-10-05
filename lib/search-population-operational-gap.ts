export type SearchPopulationResident = {
  isActive: boolean;
  statusKey: string | null;
  requiresEvacuation: boolean;
  evacuatedAt: string | null;
};

export type SearchOperationalGapResident = SearchPopulationResident & {
  residentId: string;
  firstName: string;
  lastName: string | null;
};

export type SearchOperationalGapUnit = {
  unitId: string;
  siteName: string;
  floorNumber: number | null;
  unitLabel: string;
  knownPeopleCount: number | null;
  casualtiesResolved: boolean;
  residents: SearchOperationalGapResident[];
};

export type SearchOperationalGapEntry = {
  kind: "resident" | "unidentified";
  representedCount: number;
  siteName: string;
  unitId: string;
  unitLabel: string;
  floorNumber: number | null;
  residentId: string | null;
  firstName: string | null;
  lastName: string | null;
  statusKey: string | null;
  requiresEvacuation: boolean;
  evacuatedAt: string | null;
  reason: string;
};

export function isOperationallyClosedSearchResident(
  resident: SearchPopulationResident,
  casualtiesResolved: boolean
) {
  if (!resident.isActive) return false;
  if (resident.statusKey === "resident_clear") return true;
  return ["anxiety_casualty", "physical_casualty", "deceased"].includes(resident.statusKey ?? "")
    && casualtiesResolved
    && (!resident.requiresEvacuation || resident.evacuatedAt !== null);
}

export function searchUnitPopulationMetrics(
  knownPeopleCount: number | null,
  residents: SearchPopulationResident[],
  casualtiesResolved: boolean
) {
  if (knownPeopleCount === null) return { updatedPotential: 0, closedPeople: 0, operationalGap: 0, populationUnknown: true };
  const closedPeople = Math.min(
    knownPeopleCount,
    residents.filter((resident) => isOperationallyClosedSearchResident(resident, casualtiesResolved)).length
  );
  return {
    updatedPotential: knownPeopleCount,
    closedPeople,
    operationalGap: Math.max(knownPeopleCount - closedPeople, 0),
    populationUnknown: false
  };
}

function gapReason(resident: SearchPopulationResident) {
  const casualty = ["anxiety_casualty", "physical_casualty", "deceased"].includes(resident.statusKey ?? "");
  if (casualty && resident.requiresEvacuation && resident.evacuatedAt === null) return "ממתין לפינוי";
  if (casualty) return "טיפול בנפגעים טרם הסתיים";
  return "טרם נסגר מבצעית";
}

export function searchOperationalGapDrilldown(units: SearchOperationalGapUnit[]) {
  const entries: SearchOperationalGapEntry[] = [];
  for (const unit of units) {
    const metrics = searchUnitPopulationMetrics(unit.knownPeopleCount, unit.residents, unit.casualtiesResolved);
    if (metrics.populationUnknown || metrics.operationalGap === 0) continue;
    const openResidents = unit.residents.filter((resident) => !isOperationallyClosedSearchResident(resident, unit.casualtiesResolved));
    const identified = openResidents.slice(0, metrics.operationalGap);
    for (const resident of identified) {
      entries.push({
        kind: "resident", representedCount: 1, siteName: unit.siteName, unitId: unit.unitId, unitLabel: unit.unitLabel,
        floorNumber: unit.floorNumber, residentId: resident.residentId, firstName: resident.firstName, lastName: resident.lastName,
        statusKey: resident.statusKey, requiresEvacuation: resident.requiresEvacuation, evacuatedAt: resident.evacuatedAt,
        reason: gapReason(resident)
      });
    }
    const unidentified = metrics.operationalGap - identified.length;
    if (unidentified > 0) {
      entries.push({
        kind: "unidentified", representedCount: unidentified, siteName: unit.siteName, unitId: unit.unitId, unitLabel: unit.unitLabel,
        floorNumber: unit.floorNumber, residentId: null, firstName: null, lastName: null, statusKey: null,
        requiresEvacuation: false, evacuatedAt: null, reason: "טרם זוהו/הוזנו פרטי הדיירים"
      });
    }
  }
  return { entries, total: entries.reduce((total, entry) => total + entry.representedCount, 0) };
}
