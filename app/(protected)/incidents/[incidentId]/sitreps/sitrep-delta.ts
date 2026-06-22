import { numberValue, textValue, type SitrepSnapshot } from "./sitrep-types";

export type NumericDelta = { before: number; after: number; difference: number };
export type OperationalStatusChange = {
  key: string;
  operationalNumber: number;
  name: string;
  previousStatus: string;
  currentStatus: string;
  site: string;
  team: string;
};
export type OperationalNumberDelta = { key: string; operationalNumber: number; name: string; detail: string };
export type TeamMove = { key: string; operationalNumber: number; previousTeam: string; currentTeam: string };
export type PersonnelChange = {
  department: string;
  count: NumericDelta;
  joined: string[];
  left: string[];
};
export type SiteDelta = { siteId: string; name: string; updatedPotential: NumericDelta; operationalNumbers: NumericDelta; gap: NumericDelta };
export type TeamDelta = { teamNumber: number; label: string; operationalNumbers: NumericDelta };

export type SitrepDelta = {
  hasPrevious: boolean;
  incident: {
    sites: NumericDelta;
    activeTeams: NumericDelta;
    operationalNumbers: NumericDelta;
    updatedPotential: NumericDelta;
    operationalGap: NumericDelta;
    personnel: NumericDelta;
  };
  anchor: Array<{ group: string; label: string; value: NumericDelta }>;
  sites: SiteDelta[];
  teams: TeamDelta[];
  statusChanges: OperationalStatusChange[];
  addedNumbers: OperationalNumberDelta[];
  removedNumbers: OperationalNumberDelta[];
  teamMoves: TeamMove[];
  personnelChanges: PersonnelChange[];
  gapContributors: string[];
  alerts: string[];
};

export const STATUS_GROUP_LABELS: Record<string, string> = {
  missing_unknown: "נעדר / לא ידוע",
  trapped_located_not_yet_rescued: "לכוד אותר וטרם חולץ",
  rescued: "מחולצים",
  evacuated: "פונו",
  located_outside_site: "אותרו מחוץ לאתר",
  deceased: "נפטרים",
  other: "אחר"
};

const DEPARTMENT_LABELS: Record<string, string> = {
  headquarters: "מטה",
  logistics: "לוגיסטיקה",
  population: "אוכלוסייה",
  command_post: "חפ״ק",
  medical: "רפואה",
  team_1: "צוות 1",
  team_2: "צוות 2",
  team_3: "צוות 3",
  team_4: "צוות 4",
  other: "אחר"
};

function numeric(before: number, after: number): NumericDelta {
  return { before, after, difference: after - before };
}

function personName(person: Record<string, unknown>) {
  const direct = [person.first_name, person.last_name].map((value) => textValue(value, "")).filter(Boolean).join(" ");
  const resident = [person.resident_first_name, person.resident_last_name].map((value) => textValue(value, "")).filter(Boolean).join(" ");
  return direct || resident || "שם לא ידוע";
}

function statusLabel(person: Record<string, unknown>) {
  return textValue(person.latest_report_status_label, textValue(person.current_status_label, "לא ידוע"));
}

function teamLabel(teamNumber: number) {
  return teamNumber === 9 ? "צוות אוכלוסייה" : `צוות ${teamNumber}`;
}

function statusCounts(snapshot?: SitrepSnapshot | null) {
  const counts = new Map<string, number>();
  (snapshot?.operational_numbers ?? []).forEach((person) => {
    const group = textValue(person.dashboard_status_group, "other");
    counts.set(group, (counts.get(group) ?? 0) + 1);
  });
  return counts;
}

function reportMap(snapshot?: SitrepSnapshot | null) {
  return new Map((snapshot?.operational_numbers ?? []).map((person) => [
    textValue(person.person_id, `${textValue(person.site_id, "none")}:${numberValue(person.operational_number)}`),
    person
  ]));
}

function siteMap(snapshot?: SitrepSnapshot | null) {
  return new Map((snapshot?.sites ?? []).map((site) => [textValue(site.site_id, ""), site]));
}

function personnelMap(snapshot?: SitrepSnapshot | null) {
  return new Map((snapshot?.personnel ?? []).map((person) => [textValue(person.personnel_id, ""), person]));
}

function teamCounts(snapshot?: SitrepSnapshot | null) {
  const counts = new Map<number, number>();
  (snapshot?.operational_numbers ?? []).forEach((person) => {
    const team = numberValue(person.team_number);
    counts.set(team, (counts.get(team) ?? 0) + 1);
  });
  return counts;
}

function summaryNumber(snapshot: SitrepSnapshot | null | undefined, key: string) {
  return numberValue(snapshot?.summary?.[key]);
}

export function buildSitrepDelta(current: SitrepSnapshot, previous?: SitrepSnapshot | null): SitrepDelta {
  const currentNumbers = reportMap(current);
  const previousNumbers = reportMap(previous);
  const currentSites = siteMap(current);
  const previousSites = siteMap(previous);
  const currentPersonnel = personnelMap(current);
  const previousPersonnel = personnelMap(previous);
  const currentStatusCounts = statusCounts(current);
  const previousStatusCounts = statusCounts(previous);
  const currentTeamCounts = teamCounts(current);
  const previousTeamCounts = teamCounts(previous);
  const statusChanges: OperationalStatusChange[] = [];
  const addedNumbers: OperationalNumberDelta[] = [];
  const removedNumbers: OperationalNumberDelta[] = [];
  const teamMoves: TeamMove[] = [];

  currentNumbers.forEach((person, personKey) => {
    const number = numberValue(person.operational_number);
    const old = previousNumbers.get(personKey);
    if (!old) {
      addedNumbers.push({ key: personKey, operationalNumber: number, name: personName(person), detail: statusLabel(person) });
      return;
    }

    const oldStatus = statusLabel(old);
    const newStatus = statusLabel(person);
    if (oldStatus !== newStatus) {
      statusChanges.push({
        key: personKey,
        operationalNumber: number,
        name: personName(person),
        previousStatus: oldStatus,
        currentStatus: newStatus,
        site: textValue(person.site_name, "ללא אתר"),
        team: teamLabel(numberValue(person.team_number))
      });
    }

    const oldTeam = numberValue(old.team_number);
    const newTeam = numberValue(person.team_number);
    if (oldTeam !== newTeam) {
      teamMoves.push({ key: personKey, operationalNumber: number, previousTeam: teamLabel(oldTeam), currentTeam: teamLabel(newTeam) });
    }
  });

  previousNumbers.forEach((person, personKey) => {
    const number = numberValue(person.operational_number);
    if (!currentNumbers.has(personKey)) {
      removedNumbers.push({ key: personKey, operationalNumber: number, name: personName(person), detail: statusLabel(person) });
    }
  });

  const anchorGroups = new Set([...currentStatusCounts.keys(), ...previousStatusCounts.keys()]);
  const anchor = Array.from(anchorGroups).map((group) => ({
    group,
    label: STATUS_GROUP_LABELS[group] ?? group,
    value: numeric(previousStatusCounts.get(group) ?? 0, currentStatusCounts.get(group) ?? 0)
  }));

  const sites = Array.from(new Set([...currentSites.keys(), ...previousSites.keys()])).map((siteId) => {
    const currentSite = currentSites.get(siteId);
    const previousSite = previousSites.get(siteId);
    const name = textValue(currentSite?.name, textValue(previousSite?.name, `אתר ${numberValue(currentSite?.site_number ?? previousSite?.site_number)}`));
    return {
      siteId,
      name,
      updatedPotential: numeric(numberValue(previousSite?.updated_potential), numberValue(currentSite?.updated_potential)),
      operationalNumbers: numeric(numberValue(previousSite?.active_operational_numbers_count), numberValue(currentSite?.active_operational_numbers_count)),
      gap: numeric(numberValue(previousSite?.operational_gap), numberValue(currentSite?.operational_gap))
    };
  });

  const teams = Array.from(new Set([...currentTeamCounts.keys(), ...previousTeamCounts.keys()]))
    .sort((a, b) => a - b)
    .map((teamNumber) => ({
      teamNumber,
      label: teamLabel(teamNumber),
      operationalNumbers: numeric(previousTeamCounts.get(teamNumber) ?? 0, currentTeamCounts.get(teamNumber) ?? 0)
    }));

  const departments = new Set([
    ...Array.from(currentPersonnel.values()).map((person) => textValue(person.department, "other")),
    ...Array.from(previousPersonnel.values()).map((person) => textValue(person.department, "other"))
  ]);
  const personnelChanges = Array.from(departments).map((department) => {
    const currentRows = Array.from(currentPersonnel.values()).filter((person) => textValue(person.department, "other") === department);
    const previousRows = Array.from(previousPersonnel.values()).filter((person) => textValue(person.department, "other") === department);
    const currentIds = new Set(currentRows.map((person) => textValue(person.personnel_id, "")));
    const previousIds = new Set(previousRows.map((person) => textValue(person.personnel_id, "")));
    const fullName = (person: Record<string, unknown>) => [person.first_name, person.last_name].map((value) => textValue(value, "")).filter(Boolean).join(" ") || "ללא שם";
    return {
      department: DEPARTMENT_LABELS[department] ?? textValue(currentRows[0]?.department_other, textValue(previousRows[0]?.department_other, department)),
      count: numeric(previousRows.length, currentRows.length),
      joined: currentRows.filter((person) => !previousIds.has(textValue(person.personnel_id, ""))).map(fullName),
      left: previousRows.filter((person) => !currentIds.has(textValue(person.personnel_id, ""))).map(fullName)
    };
  }).filter((change) => change.count.difference !== 0 || change.joined.length > 0 || change.left.length > 0);

  const gapBefore = summaryNumber(previous, "operational_gap");
  const gapAfter = summaryNumber(current, "operational_gap");
  const potentialDifference = summaryNumber(current, "updated_potential") - summaryNumber(previous, "updated_potential");
  const gapContributors = [
    ...(potentialDifference !== 0 ? [`פוטנציאל מעודכן ${potentialDifference > 0 ? "+" : ""}${potentialDifference}`] : []),
    ...addedNumbers.map((person) => `#${person.operationalNumber} נוסף למענה המבצעי`),
    ...removedNumbers.map((person) => `#${person.operationalNumber} הוסר מהמענה המבצעי`)
  ];

  const alerts: string[] = [];
  const trapped = currentStatusCounts.get("trapped_located_not_yet_rescued") ?? 0;
  if (trapped > 0) alerts.push(`${trapped} לכודים אותרו אך טרם חולצו`);
  if (gapAfter > 0) {
    sites.filter((site) => site.gap.after > 0 && site.gap.after / gapAfter > 0.6)
      .forEach((site) => alerts.push(`${site.name} מהווה מעל 60% מהפער המבצעי`));
  }
  if (previous && gapBefore === gapAfter) {
    const minutes = Math.floor((new Date(current.captured_at).getTime() - new Date(previous.captured_at).getTime()) / 60000);
    if (minutes >= 45) alerts.push(`לא נרשם שינוי בפער המבצעי ב-${minutes} הדקות שבין החיתוכים`);
  }
  if (previous) {
    teams.filter((team) => team.operationalNumbers.after > 0 && team.operationalNumbers.difference === 0)
      .filter((team) => !statusChanges.some((change) => change.team === team.label) && !teamMoves.some((move) => move.previousTeam === team.label || move.currentTeam === team.label))
      .forEach((team) => alerts.push(`${team.label} ללא פעילות מבצעית חדשה מאז החיתוך הקודם`));
  }

  return {
    hasPrevious: Boolean(previous),
    incident: {
      sites: numeric(summaryNumber(previous, "total_sites"), summaryNumber(current, "total_sites")),
      activeTeams: numeric(summaryNumber(previous, "active_teams"), summaryNumber(current, "active_teams")),
      operationalNumbers: numeric(summaryNumber(previous, "active_operational_numbers_count"), summaryNumber(current, "active_operational_numbers_count")),
      updatedPotential: numeric(summaryNumber(previous, "updated_potential"), summaryNumber(current, "updated_potential")),
      operationalGap: numeric(gapBefore, gapAfter),
      personnel: numeric(previousPersonnel.size, currentPersonnel.size)
    },
    anchor,
    sites,
    teams,
    statusChanges,
    addedNumbers,
    removedNumbers,
    teamMoves,
    personnelChanges,
    gapContributors,
    alerts
  };
}
