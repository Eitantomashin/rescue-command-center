export type OrganicTeamReferenceRow = {
  id: string;
  team_number: number;
  name: string | null;
  is_active: boolean;
};

export type OrganicTeamReinforcementRow = {
  id: string;
  unit_personnel_id: string | null;
  manual_personnel_id: string | null;
  source_team_id: string;
  source_team_number: number;
  destination_team_id: string;
  destination_team_number: number;
  notes: string | null;
  assigned_at: string;
};

export type OperationalTeamReference = {
  id: string;
  number: number;
  name: string;
  isActive: boolean;
};

export type ActiveOrganicTeamReinforcement = {
  id: string;
  unitPersonnelId: string | null;
  manualPersonnelId: string | null;
  organicTeam: OperationalTeamReference;
  operationalTeam: OperationalTeamReference;
  notes: string | null;
  assignedAt: string;
};

export type OrganicTeamReinforcementModel = {
  activeReinforcements: ActiveOrganicTeamReinforcement[];
  byUnitPersonnelId: Map<string, ActiveOrganicTeamReinforcement>;
  byManualPersonnelId: Map<string, ActiveOrganicTeamReinforcement>;
  activeTargetTeams: OperationalTeamReference[];
};

export type OrganicTeamReinforcementCandidate = {
  key: `roster:${string}` | `manual:${string}`;
  name: string;
  sourceKind: "roster" | "manual";
  organicTeam: OperationalTeamReference;
};

export type OperationalTeamRosterSummary = {
  team: OperationalTeamReference;
  organicPresent: number;
  outgoingReinforcements: number;
  incomingReinforcements: number;
  adHocMembers: number;
  operationalPersonnel: number;
};

export type OperationalTeamRosterModel = {
  teams: OperationalTeamRosterSummary[];
  totalOperationalPersonnel: number;
};

export function isOperationalTeamRosterDataAvailable(errors: unknown[]) {
  return errors.every((error) => !error);
}

export function isIncidentActiveForOrganicTeamReinforcements(incident: {
  lifecycleStatus: string | null;
  isClosed: boolean | null;
  archivedAt: string | null;
} | null | undefined) {
  return incident?.lifecycleStatus === "active"
    && incident.isClosed === false
    && incident.archivedAt === null;
}

type RosterReinforcementCandidateSource = {
  id: string;
  firstName: string;
  lastName: string;
  department: string;
  attendanceStatus: string;
};

type ManualReinforcementCandidateSource = {
  id: string;
  firstName: string;
  lastName: string;
  organicTeamId: string | null;
  attendanceStatus: string;
};

function organicTeamNumberForDepartment(department: string) {
  const match = /^team_([1-4])$/.exec(department);
  return match ? Number(match[1]) : null;
}

export function calculateOperationalTeamRoster({
  teams,
  rosterPersonnel,
  manualPersonnel,
  activeReinforcements,
  activeAdHocMemberKeys
}: {
  teams: OrganicTeamReferenceRow[];
  rosterPersonnel: Array<{ key: `roster:${string}`; department: string; attendanceStatus: string }>;
  manualPersonnel: Array<{ key: `manual:${string}`; organicTeamId: string | null; attendanceStatus: string }>;
  activeReinforcements: ActiveOrganicTeamReinforcement[];
  activeAdHocMemberKeys: Set<string>;
}): OperationalTeamRosterModel {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const sourceTeamsByNumber = new Map<number, OrganicTeamReferenceRow[]>();
  const activeTeams = teams
    .filter((team) => team.is_active && team.team_number >= 1 && team.team_number <= 4)
    .sort((left, right) => left.team_number - right.team_number);
  const summaries = new Map(activeTeams.map((team) => [team.id, {
    team: teamReference(team.id, team.team_number, teamsById),
    organicPresent: 0,
    outgoingReinforcements: 0,
    incomingReinforcements: 0,
    adHocMembers: 0,
    operationalPersonnel: 0
  }]));
  const reinforcementsByKey = new Map<string, ActiveOrganicTeamReinforcement>();
  const personnelByKey = new Map<string, { attendanceStatus: string; sourceTeamId: string | null }>();

  for (const team of teams) {
    if (team.team_number < 1 || team.team_number > 4) continue;
    sourceTeamsByNumber.set(team.team_number, [...(sourceTeamsByNumber.get(team.team_number) ?? []), team]);
  }
  for (const reinforcement of activeReinforcements) {
    if (reinforcement.unitPersonnelId) reinforcementsByKey.set(`roster:${reinforcement.unitPersonnelId}`, reinforcement);
    if (reinforcement.manualPersonnelId) reinforcementsByKey.set(`manual:${reinforcement.manualPersonnelId}`, reinforcement);
  }
  for (const person of rosterPersonnel) {
    const sourceNumber = organicTeamNumberForDepartment(person.department);
    const sourceTeams = sourceNumber === null ? [] : sourceTeamsByNumber.get(sourceNumber) ?? [];
    personnelByKey.set(person.key, { attendanceStatus: person.attendanceStatus, sourceTeamId: sourceTeams.length === 1 ? sourceTeams[0].id : null });
  }
  for (const person of manualPersonnel) {
    personnelByKey.set(person.key, { attendanceStatus: person.attendanceStatus, sourceTeamId: person.organicTeamId });
  }

  for (const [key, person] of Array.from(personnelByKey.entries())) {
    if (person.attendanceStatus !== "present" || !person.sourceTeamId) continue;
    const sourceSummary = summaries.get(person.sourceTeamId);
    const reinforcement = reinforcementsByKey.get(key);

    if (sourceSummary) sourceSummary.organicPresent += 1;
    if (activeAdHocMemberKeys.has(key)) {
      if (sourceSummary) sourceSummary.adHocMembers += 1;
      continue;
    }

    if (reinforcement) {
      if (sourceSummary) sourceSummary.outgoingReinforcements += 1;
      const destinationSummary = summaries.get(reinforcement.operationalTeam.id);
      if (destinationSummary) {
        destinationSummary.incomingReinforcements += 1;
        destinationSummary.operationalPersonnel += 1;
      }
      continue;
    }

    if (sourceSummary) sourceSummary.operationalPersonnel += 1;
  }

  const result = activeTeams.map((team) => summaries.get(team.id)!);
  return {
    teams: result,
    totalOperationalPersonnel: result.reduce((total, team) => total + team.operationalPersonnel, 0)
  };
}

export function buildEligibleOrganicTeamReinforcementCandidates({
  rosterPersonnel,
  manualPersonnel,
  teams,
  activeReinforcementKeys,
  activeAdHocMemberKeys
}: {
  rosterPersonnel: RosterReinforcementCandidateSource[];
  manualPersonnel: ManualReinforcementCandidateSource[];
  teams: OrganicTeamReferenceRow[];
  activeReinforcementKeys: Set<string>;
  activeAdHocMemberKeys: Set<string>;
}): OrganicTeamReinforcementCandidate[] {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const teamsByNumber = new Map<number, OrganicTeamReferenceRow[]>();
  for (const team of teams) {
    if (team.team_number < 1 || team.team_number > 4) continue;
    teamsByNumber.set(team.team_number, [...(teamsByNumber.get(team.team_number) ?? []), team]);
  }

  const candidates: OrganicTeamReinforcementCandidate[] = [];
  const append = (
    sourceKind: "roster" | "manual",
    id: string,
    firstName: string,
    lastName: string,
    sourceTeam: OrganicTeamReferenceRow | undefined
  ) => {
    const key = `${sourceKind}:${id}` as OrganicTeamReinforcementCandidate["key"];
    if (!sourceTeam || activeReinforcementKeys.has(key) || activeAdHocMemberKeys.has(key)) return;
    candidates.push({
      key,
      name: `${firstName} ${lastName}`.trim(),
      sourceKind,
      organicTeam: teamReference(sourceTeam.id, sourceTeam.team_number, teamById)
    });
  };

  for (const person of rosterPersonnel) {
    if (person.attendanceStatus !== "present") continue;
    const sourceTeamNumber = organicTeamNumberForDepartment(person.department);
    const matchingTeams = sourceTeamNumber === null ? [] : teamsByNumber.get(sourceTeamNumber) ?? [];
    if (matchingTeams.length === 1) {
      append("roster", person.id, person.firstName, person.lastName, matchingTeams[0]);
    }
  }

  for (const person of manualPersonnel) {
    if (person.attendanceStatus !== "present" || !person.organicTeamId) continue;
    const sourceTeam = teamById.get(person.organicTeamId);
    if (sourceTeam && sourceTeam.team_number >= 1 && sourceTeam.team_number <= 4) {
      append("manual", person.id, person.firstName, person.lastName, sourceTeam);
    }
  }

  return candidates.sort((left, right) => left.name.localeCompare(right.name, "he"));
}

function teamReference(
  id: string,
  number: number,
  teamsById: Map<string, OrganicTeamReferenceRow>
): OperationalTeamReference {
  const team = teamsById.get(id);

  return {
    id,
    number,
    name: team?.name?.trim() || `צוות ${number}`,
    isActive: team?.is_active ?? false
  };
}

export function mapActiveOrganicTeamReinforcements(
  rows: OrganicTeamReinforcementRow[],
  teams: OrganicTeamReferenceRow[]
): OrganicTeamReinforcementModel {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const activeReinforcements: ActiveOrganicTeamReinforcement[] = [];
  const byUnitPersonnelId = new Map<string, ActiveOrganicTeamReinforcement>();
  const byManualPersonnelId = new Map<string, ActiveOrganicTeamReinforcement>();

  for (const row of rows) {
    const hasUnitPersonnel = Boolean(row.unit_personnel_id);
    const hasManualPersonnel = Boolean(row.manual_personnel_id);

    // The database check constraint guarantees this. Keeping the read model
    // defensive avoids assigning an ambiguous operational team if legacy data
    // ever violates the expected shape.
    if (hasUnitPersonnel === hasManualPersonnel) continue;

    const reinforcement: ActiveOrganicTeamReinforcement = {
      id: row.id,
      unitPersonnelId: row.unit_personnel_id,
      manualPersonnelId: row.manual_personnel_id,
      organicTeam: teamReference(row.source_team_id, row.source_team_number, teamsById),
      operationalTeam: teamReference(row.destination_team_id, row.destination_team_number, teamsById),
      notes: row.notes,
      assignedAt: row.assigned_at
    };

    activeReinforcements.push(reinforcement);
    if (row.unit_personnel_id) byUnitPersonnelId.set(row.unit_personnel_id, reinforcement);
    if (row.manual_personnel_id) byManualPersonnelId.set(row.manual_personnel_id, reinforcement);
  }

  return {
    activeReinforcements,
    byUnitPersonnelId,
    byManualPersonnelId,
    activeTargetTeams: teams
      .filter((team) => team.is_active && team.team_number >= 1 && team.team_number <= 4)
      .sort((left, right) => left.team_number - right.team_number)
      .map((team) => teamReference(team.id, team.team_number, teamsById))
  };
}

export function isMissingOrganicTeamReinforcementsTable(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  const referencesReinforcementTable = /(?:public\.)?incident_organic_team_reinforcements/i.test(message);

  return referencesReinforcementTable
    && (code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message));
}
