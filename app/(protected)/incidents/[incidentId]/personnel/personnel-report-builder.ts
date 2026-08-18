import { createClient } from "@/lib/supabase/server";
import {
  personnelDepartmentLabel,
  personnelRoleLabel
} from "../../../personnel/personnel-options";

export type PersonnelReportPerson = {
  key: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  phone: string | null;
  source: "unit" | "manual";
  sourceLabel: string;
  sourceNote: string | null;
  organicTeamKey: string | null;
  organicTeamLabel: string | null;
  sortPriority: number;
};

export type PersonnelReportOrganicTeam = {
  key: string;
  label: string;
  presentCount: number;
  commanderNames: string[];
  deputyNames: string[];
  people: PersonnelReportPerson[];
};

export type PersonnelReportAdHocTeam = {
  id: string;
  name: string;
  purpose: string | null;
  relatedSiteName: string | null;
  commanderName: string | null;
  notes: string | null;
  presentCount: number;
  people: Array<PersonnelReportPerson & { adHocRole: string | null }>;
};

export type PersonnelReportModel = {
  generatedAt: string;
  incident: {
    id: string;
    name: string;
    status: string | null;
    openedAt: string | null;
  };
  uniquePresentTotal: number;
  organicTeamTotal: number;
  manuallyAddedPresentCount: number;
  adHocAssignedPresentCount: number;
  unassignedPresentCount: number;
  activeOrganicTeamsRepresented: number;
  activeAdHocTeamsRepresented: number;
  presentCommanderCount: number;
  presentDeputyCount: number;
  organicTeams: PersonnelReportOrganicTeam[];
  adHocTeams: PersonnelReportAdHocTeam[];
  unassignedPeople: PersonnelReportPerson[];
};

type IncidentRow = {
  id: string;
  name: string;
  opened_at: string | null;
  lifecycle_status?: string | null;
};

type UnitPersonnelRow = {
  id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  role_other: string | null;
  department: string | null;
  department_other: string | null;
  mobile_phone: string | null;
  is_active: boolean;
};

type StatusRow = {
  personnel_id: string;
  attendance_status: string;
  updated_at: string;
};

type TeamRow = {
  id: string;
  team_number: number;
  name: string | null;
  is_active: boolean;
};

type SiteRow = {
  id: string;
  name: string;
};

type ManualPersonnelRow = {
  id: string;
  first_name: string;
  last_name: string;
  mobile_phone: string | null;
  role: string | null;
  notes: string | null;
  organic_team_id: string | null;
  attendance_status: string;
  source_type: string;
  is_active: boolean;
};

type AdHocTeamRow = {
  id: string;
  name: string;
  purpose: string | null;
  related_site_id: string | null;
  commander_name: string | null;
  notes: string | null;
  status: string;
};

type AdHocMemberRow = {
  id: string;
  ad_hoc_team_id: string;
  unit_personnel_id: string | null;
  manual_personnel_id: string | null;
  notes: string | null;
};

const COMMANDER_ROLES = new Set(["מפקד צוות", "מפק\"צ", "מפק״צ", "commander", "team_commander"]);
const DEPUTY_ROLES = new Set(["סגן מפקד", "סגן מפקד צוות", "deputy", "deputy_commander"]);

function clean(value: string | null | undefined, fallback = "לא צוין") {
  return value?.trim() || fallback;
}

function rolePriority(role: string | null | undefined) {
  const normalized = role?.trim().toLowerCase();
  if (!normalized) return 3;
  if (COMMANDER_ROLES.has(normalized)) return 1;
  if (DEPUTY_ROLES.has(normalized)) return 2;
  return 3;
}

function comparePeople(a: PersonnelReportPerson, b: PersonnelReportPerson) {
  return a.sortPriority - b.sortPriority || a.lastName.localeCompare(b.lastName, "he") || a.firstName.localeCompare(b.firstName, "he");
}

function comparePeopleAlpha(a: PersonnelReportPerson, b: PersonnelReportPerson) {
  return a.lastName.localeCompare(b.lastName, "he") || a.firstName.localeCompare(b.firstName, "he");
}

function teamLabel(team: TeamRow | null | undefined) {
  if (!team) return "ללא צוות אורגני";
  return team.name?.trim() ? team.name : `צוות ${team.team_number}`;
}

function adHocCommanderName(configuredName: string | null, people: PersonnelReportPerson[]) {
  const expected = configuredName?.trim();
  if (!expected) return null;
  return people.find((person) => person.fullName === expected)?.fullName ?? null;
}

export async function buildIncidentPersonnelReport(incidentId: string): Promise<PersonnelReportModel | null> {
  const supabase = createClient();
  const { data: canRead } = await supabase.rpc("can_read_incident", { p_incident_id: incidentId });
  if (!canRead) return null;

  const [
    { data: incident },
    { data: personnelRows },
    { data: statusRows },
    { data: teamRows },
    { data: siteRows },
    { data: manualRows },
    { data: adHocTeamRows },
    { data: adHocMemberRows }
  ] = await Promise.all([
    supabase.from("incidents").select("id,name,opened_at,lifecycle_status").eq("id", incidentId).maybeSingle(),
    supabase
      .from("unit_personnel")
      .select("id,first_name,last_name,role,role_other,department,department_other,mobile_phone,is_active")
      .eq("is_active", true),
    supabase.from("event_personnel_status").select("personnel_id,attendance_status,updated_at").eq("incident_id", incidentId),
    supabase.from("teams").select("id,team_number,name,is_active").eq("incident_id", incidentId).eq("is_active", true).order("team_number", { ascending: true }),
    supabase.from("sites").select("id,name").eq("incident_id", incidentId).order("name", { ascending: true }),
    supabase
      .from("incident_manual_personnel")
      .select("id,first_name,last_name,mobile_phone,role,notes,organic_team_id,attendance_status,source_type,is_active")
      .eq("incident_id", incidentId)
      .eq("is_active", true),
    supabase.from("incident_ad_hoc_teams").select("id,name,purpose,related_site_id,commander_name,notes,status").eq("incident_id", incidentId),
    supabase
      .from("incident_ad_hoc_team_members")
      .select("id,ad_hoc_team_id,unit_personnel_id,manual_personnel_id,notes")
      .eq("incident_id", incidentId)
      .eq("is_active", true)
  ]);

  if (!incident) return null;

  const statusesByPerson = new Map(((statusRows ?? []) as StatusRow[]).map((row) => [row.personnel_id, row.attendance_status]));
  const teamsById = new Map(((teamRows ?? []) as TeamRow[]).map((team) => [team.id, team]));
  const sitesById = new Map(((siteRows ?? []) as SiteRow[]).map((site) => [site.id, site]));
  const people = new Map<string, PersonnelReportPerson>();

  ((personnelRows ?? []) as UnitPersonnelRow[]).forEach((row) => {
    if (!row.is_active || statusesByPerson.get(row.id) !== "present") return;
    const role = personnelRoleLabel(row.role ?? undefined, row.role_other);
    const team = personnelDepartmentLabel(row.department ?? undefined, row.department_other);
    people.set(`unit:${row.id}`, {
      key: `unit:${row.id}`,
      firstName: clean(row.first_name, "-"),
      lastName: clean(row.last_name, ""),
      fullName: `${clean(row.first_name, "")} ${clean(row.last_name, "")}`.trim() || "לא צוין",
      role,
      phone: row.mobile_phone,
      source: "unit",
      sourceLabel: "סגל יחידה",
      sourceNote: null,
      organicTeamKey: row.department ? `department:${row.department}:${row.department_other ?? ""}` : null,
      organicTeamLabel: row.department ? team : null,
      sortPriority: rolePriority(row.role_other ?? row.role)
    });
  });

  ((manualRows ?? []) as ManualPersonnelRow[]).forEach((row) => {
    if (!row.is_active || row.attendance_status !== "present") return;
    const organicTeam = teamsById.get(row.organic_team_id ?? "");
    people.set(`manual:${row.id}`, {
      key: `manual:${row.id}`,
      firstName: clean(row.first_name, "-"),
      lastName: clean(row.last_name, ""),
      fullName: `${clean(row.first_name, "")} ${clean(row.last_name, "")}`.trim() || "לא צוין",
      role: clean(row.role, "תפקיד לא הוגדר"),
      phone: row.mobile_phone,
      source: "manual",
      sourceLabel: "נוסף ידנית",
      sourceNote: row.notes,
      organicTeamKey: row.organic_team_id ? `team:${row.organic_team_id}` : null,
      organicTeamLabel: row.organic_team_id ? teamLabel(organicTeam) : null,
      sortPriority: rolePriority(row.role)
    });
  });

  const activeAdHocTeams = ((adHocTeamRows ?? []) as AdHocTeamRow[]).filter((team) => team.status === "active");
  const activeAdHocTeamIds = new Set(activeAdHocTeams.map((team) => team.id));
  const adHocMembershipsByPerson = new Map<string, AdHocMemberRow[]>();

  ((adHocMemberRows ?? []) as AdHocMemberRow[]).forEach((member) => {
    if (!activeAdHocTeamIds.has(member.ad_hoc_team_id)) return;
    const key = member.unit_personnel_id ? `unit:${member.unit_personnel_id}` : member.manual_personnel_id ? `manual:${member.manual_personnel_id}` : null;
    if (!key || !people.has(key)) return;
    const memberships = adHocMembershipsByPerson.get(key) ?? [];
    memberships.push(member);
    adHocMembershipsByPerson.set(key, memberships);
  });

  const organicTeamsMap = new Map<string, PersonnelReportOrganicTeam>();
  Array.from(people.values()).forEach((person) => {
    if (!person.organicTeamKey || !person.organicTeamLabel) return;
    const team = organicTeamsMap.get(person.organicTeamKey) ?? {
      key: person.organicTeamKey,
      label: person.organicTeamLabel,
      presentCount: 0,
      commanderNames: [],
      deputyNames: [],
      people: []
    };
    team.people.push(person);
    organicTeamsMap.set(person.organicTeamKey, team);
  });

  const organicTeams = Array.from(organicTeamsMap.values())
    .map((team) => {
      const sorted = team.people.sort(comparePeople);
      return {
        ...team,
        presentCount: sorted.length,
        people: sorted,
        commanderNames: sorted.filter((person) => person.sortPriority === 1).map((person) => person.fullName),
        deputyNames: sorted.filter((person) => person.sortPriority === 2).map((person) => person.fullName)
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "he"));

  const adHocTeams = activeAdHocTeams
    .map((team) => {
      const members = ((adHocMemberRows ?? []) as AdHocMemberRow[])
        .filter((member) => member.ad_hoc_team_id === team.id)
        .map((member) => {
          const key = member.unit_personnel_id ? `unit:${member.unit_personnel_id}` : member.manual_personnel_id ? `manual:${member.manual_personnel_id}` : null;
          const person = key ? people.get(key) : null;
          return person ? { ...person, adHocRole: member.notes } : null;
        })
        .filter((person): person is PersonnelReportPerson & { adHocRole: string | null } => Boolean(person));
      const configuredCommander = adHocCommanderName(team.commander_name, members);
      const sorted = members.sort((a, b) => {
        const aCommander = configuredCommander && a.fullName === configuredCommander ? 0 : 1;
        const bCommander = configuredCommander && b.fullName === configuredCommander ? 0 : 1;
        return aCommander - bCommander || comparePeople(a, b);
      });
      return {
        id: team.id,
        name: clean(team.name, "צוות אד-הוק"),
        purpose: team.purpose,
        relatedSiteName: team.related_site_id ? sitesById.get(team.related_site_id)?.name ?? null : null,
        commanderName: configuredCommander,
        notes: team.notes,
        presentCount: sorted.length,
        people: sorted
      };
    })
    .filter((team) => team.presentCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  const unassignedPeople = Array.from(people.values())
    .filter((person) => !person.organicTeamKey && !adHocMembershipsByPerson.has(person.key))
    .sort(comparePeopleAlpha);

  const organicTeamPeople = new Set<string>();
  organicTeams.forEach((team) => team.people.forEach((person) => organicTeamPeople.add(person.key)));
  const adHocPeople = new Set<string>(Array.from(adHocMembershipsByPerson.keys()));

  return {
    generatedAt: new Date().toISOString(),
    incident: {
      id: incident.id,
      name: incident.name,
      status: incident.lifecycle_status ?? null,
      openedAt: incident.opened_at
    },
    uniquePresentTotal: people.size,
    organicTeamTotal: organicTeamPeople.size,
    manuallyAddedPresentCount: Array.from(people.values()).filter((person) => person.source === "manual").length,
    adHocAssignedPresentCount: adHocPeople.size,
    unassignedPresentCount: unassignedPeople.length,
    activeOrganicTeamsRepresented: organicTeams.length,
    activeAdHocTeamsRepresented: adHocTeams.length,
    presentCommanderCount: Array.from(people.values()).filter((person) => person.sortPriority === 1).length,
    presentDeputyCount: Array.from(people.values()).filter((person) => person.sortPriority === 2).length,
    organicTeams,
    adHocTeams,
    unassignedPeople
  };
}
