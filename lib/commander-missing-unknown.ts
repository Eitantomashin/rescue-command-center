export type CommanderOperationalPerson = {
  personId: string;
  dashboardStatusGroup: string | null;
};

export type CommanderResident = {
  id: string;
  siteId: string;
  firstName: string | null;
  lastName: string | null;
  statusKey: string | null;
  linkedPersonId: string | null;
  isActive: boolean;
  notes: string | null;
  gender: string | null;
  age: number | null;
  phone: string | null;
  requiresMedicalEvacuation: boolean | null;
};

// Keep this signature aligned with the historical Rescue placeholder check in
// 20261005160000_rescue_resident_import_unit_population.sql.
export function isStrictRescueResidentPlaceholder(resident: CommanderResident) {
  return (
    resident.notes === "placeholder" &&
    /^דייר [0-9]+$/.test(resident.firstName ?? "") &&
    resident.lastName === null &&
    (resident.gender ?? "unknown") === "unknown" &&
    resident.age === null &&
    resident.phone === null &&
    resident.linkedPersonId === null &&
    !resident.requiresMedicalEvacuation &&
    resident.statusKey === "missing"
  );
}

export function commanderMissingUnknownResidents({
  residents,
  nonMergedPersonIds,
  searchSiteIds
}: {
  residents: CommanderResident[];
  nonMergedPersonIds: ReadonlySet<string>;
  searchSiteIds: ReadonlySet<string>;
}) {
  return residents.filter(
    (resident) =>
      resident.isActive &&
      resident.statusKey === "missing" &&
      !searchSiteIds.has(resident.siteId) &&
      !isStrictRescueResidentPlaceholder(resident) &&
      !(resident.linkedPersonId && nonMergedPersonIds.has(resident.linkedPersonId))
  );
}
