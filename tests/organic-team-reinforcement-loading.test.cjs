const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadReinforcementModel() {
  const filename = path.resolve(__dirname, "../lib/organic-team-reinforcements.ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    module.exports,
    require,
    module,
    filename,
    path.dirname(filename)
  );
  return module.exports;
}

const {
  buildEligibleOrganicTeamReinforcementCandidates,
  calculateOperationalTeamRoster,
  isIncidentActiveForOrganicTeamReinforcements,
  isMissingOrganicTeamReinforcementsTable,
  isOperationalTeamRosterDataAvailable,
  mapActiveOrganicTeamReinforcements
} = loadReinforcementModel();

test("active organic reinforcements preserve the organic source and map the current operational destination by personnel source", () => {
  const model = mapActiveOrganicTeamReinforcements([
    {
      id: "reinforcement-unit",
      unit_personnel_id: "unit-1",
      manual_personnel_id: null,
      source_team_id: "team-1",
      source_team_number: 1,
      destination_team_id: "team-2",
      destination_team_number: 2,
      notes: "סיוע",
      assigned_at: "2026-10-12T10:00:00Z"
    },
    {
      id: "reinforcement-manual",
      unit_personnel_id: null,
      manual_personnel_id: "manual-1",
      source_team_id: "team-3",
      source_team_number: 3,
      destination_team_id: "team-2",
      destination_team_number: 2,
      notes: null,
      assigned_at: "2026-10-12T10:01:00Z"
    },
    {
      id: "invalid-ambiguous-row",
      unit_personnel_id: "unit-2",
      manual_personnel_id: "manual-2",
      source_team_id: "team-1",
      source_team_number: 1,
      destination_team_id: "team-2",
      destination_team_number: 2,
      notes: null,
      assigned_at: "2026-10-12T10:02:00Z"
    }
  ], [
    { id: "team-1", team_number: 1, name: "צוות 1", is_active: false },
    { id: "team-2", team_number: 2, name: "צוות 2", is_active: true },
    { id: "team-3", team_number: 3, name: null, is_active: true },
    { id: "team-5", team_number: 5, name: "צוות 5", is_active: true }
  ]);

  assert.equal(model.activeReinforcements.length, 2);
  assert.equal(model.byUnitPersonnelId.get("unit-1").organicTeam.number, 1);
  assert.equal(model.byUnitPersonnelId.get("unit-1").organicTeam.isActive, false);
  assert.equal(model.byUnitPersonnelId.get("unit-1").operationalTeam.number, 2);
  assert.equal(model.byManualPersonnelId.get("manual-1").organicTeam.name, "צוות 3");
  assert.equal(model.byManualPersonnelId.get("manual-1").operationalTeam.number, 2);
  assert.equal(model.byUnitPersonnelId.has("unit-2"), false);
  assert.deepEqual(model.activeTargetTeams.map((team) => team.number), [2, 3]);
});

test("only a recognizable missing reinforcement table error is treated as compatibility fallback", () => {
  assert.equal(isMissingOrganicTeamReinforcementsTable({
    code: "PGRST205",
    message: "Could not find the table 'public.incident_organic_team_reinforcements' in the schema cache"
  }), true);
  assert.equal(isMissingOrganicTeamReinforcementsTable({
    code: "42P01",
    message: "relation public.incident_organic_team_reinforcements does not exist"
  }), true);
  assert.equal(isMissingOrganicTeamReinforcementsTable({
    code: "PGRST205",
    message: "Could not find the table 'public.unrelated_table' in the schema cache"
  }), false);
  assert.equal(isMissingOrganicTeamReinforcementsTable({
    code: "57014",
    message: "canceling statement due to statement timeout"
  }), false);
});

test("operational roster availability distinguishes successful empty sources from any required-source loading error", () => {
  assert.equal(isOperationalTeamRosterDataAvailable([null, undefined, null, undefined, null, undefined]), true);

  for (const sourceError of [
    { code: "personnel" },
    { code: "attendance" },
    { code: "organic-teams" },
    { code: "manual-personnel" },
    { code: "ad-hoc-members" },
    { code: "reinforcements" }
  ]) {
    assert.equal(isOperationalTeamRosterDataAvailable([null, null, sourceError]), false);
  }
});

test("organic reinforcement UI actions require the complete active incident lifecycle state", () => {
  assert.equal(isIncidentActiveForOrganicTeamReinforcements({
    lifecycleStatus: "active",
    isClosed: false,
    archivedAt: null
  }), true);
  assert.equal(isIncidentActiveForOrganicTeamReinforcements({
    lifecycleStatus: "paused",
    isClosed: false,
    archivedAt: null
  }), false);
  assert.equal(isIncidentActiveForOrganicTeamReinforcements({
    lifecycleStatus: "closed",
    isClosed: true,
    archivedAt: null
  }), false);
  assert.equal(isIncidentActiveForOrganicTeamReinforcements({
    lifecycleStatus: "active",
    isClosed: false,
    archivedAt: "2026-10-12T10:00:00Z"
  }), false);
});

test("organic reinforcement candidates include only present, unassigned personnel with one recognized organic source team", () => {
  const candidates = buildEligibleOrganicTeamReinforcementCandidates({
    rosterPersonnel: [
      { id: "roster-eligible", firstName: "איתן", lastName: "כהן", department: "team_1", attendanceStatus: "present" },
      { id: "roster-not-present", firstName: "לא", lastName: "נוכח", department: "team_1", attendanceStatus: "unavailable" },
      { id: "roster-reinforced", firstName: "כבר", lastName: "בתגבור", department: "team_1", attendanceStatus: "present" },
      { id: "roster-ad-hoc", firstName: "אד", lastName: "הוק", department: "team_1", attendanceStatus: "present" },
      { id: "roster-no-organic", firstName: "ללא", lastName: "צוות", department: "medical", attendanceStatus: "present" }
    ],
    manualPersonnel: [
      { id: "manual-eligible", firstName: "מיכל", lastName: "לוי", organicTeamId: "team-2", attendanceStatus: "present" },
      { id: "manual-no-team", firstName: "ללא", lastName: "מקור", organicTeamId: null, attendanceStatus: "present" },
      { id: "manual-ad-hoc", firstName: "ידני", lastName: "אד-הוק", organicTeamId: "team-2", attendanceStatus: "present" }
    ],
    teams: [
      { id: "team-1", team_number: 1, name: "צוות 1", is_active: false },
      { id: "team-2", team_number: 2, name: "צוות 2", is_active: true }
    ],
    activeReinforcementKeys: new Set(["roster:roster-reinforced"]),
    activeAdHocMemberKeys: new Set(["roster:roster-ad-hoc", "manual:manual-ad-hoc"])
  });

  assert.deepEqual(candidates.map((candidate) => candidate.key).sort(), ["manual:manual-eligible", "roster:roster-eligible"]);
  assert.equal(candidates.find((candidate) => candidate.key === "roster:roster-eligible").organicTeam.isActive, false);
  assert.equal(candidates.find((candidate) => candidate.key === "manual:manual-eligible").organicTeam.number, 2);
});

test("operational team roster counts each present person once across organic reinforcement and ad-hoc assignments", () => {
  const teams = [
    { id: "team-1", team_number: 1, name: "צוות 1", is_active: true },
    { id: "team-2", team_number: 2, name: "צוות 2", is_active: true },
    { id: "team-3", team_number: 3, name: "צוות 3", is_active: true },
    { id: "team-4", team_number: 4, name: "צוות 4", is_active: false }
  ];
  const activeReinforcements = mapActiveOrganicTeamReinforcements([
    {
      id: "transfer-1-to-3",
      unit_personnel_id: "regular-transfer",
      manual_personnel_id: null,
      source_team_id: "team-1",
      source_team_number: 1,
      destination_team_id: "team-3",
      destination_team_number: 3,
      notes: null,
      assigned_at: "2026-10-12T10:00:00Z"
    },
    {
      id: "manual-2-to-3",
      unit_personnel_id: null,
      manual_personnel_id: "manual-transfer",
      source_team_id: "team-2",
      source_team_number: 2,
      destination_team_id: "team-3",
      destination_team_number: 3,
      notes: null,
      assigned_at: "2026-10-12T10:01:00Z"
    }
  ], teams).activeReinforcements;
  const roster = calculateOperationalTeamRoster({
    teams,
    rosterPersonnel: [
      { key: "roster:regular-home", department: "team_1", attendanceStatus: "present" },
      { key: "roster:regular-transfer", department: "team_1", attendanceStatus: "present" },
      { key: "roster:regular-ad-hoc", department: "team_2", attendanceStatus: "present" },
      { key: "roster:not-present", department: "team_2", attendanceStatus: "unavailable" },
      { key: "roster:inactive-source", department: "team_4", attendanceStatus: "present" }
    ],
    manualPersonnel: [
      { key: "manual:manual-transfer", organicTeamId: "team-2", attendanceStatus: "present" },
      { key: "manual:manual-home", organicTeamId: "team-2", attendanceStatus: "present" },
      { key: "manual:no-source", organicTeamId: null, attendanceStatus: "present" }
    ],
    activeReinforcements,
    activeAdHocMemberKeys: new Set(["roster:regular-ad-hoc"])
  });

  assert.deepEqual(roster.teams.map((team) => team.team.number), [1, 2, 3]);
  assert.deepEqual(roster.teams.map((team) => ({
    organic: team.organicPresent,
    outgoing: team.outgoingReinforcements,
    incoming: team.incomingReinforcements,
    adHoc: team.adHocMembers,
    operational: team.operationalPersonnel
  })), [
    { organic: 2, outgoing: 1, incoming: 0, adHoc: 0, operational: 1 },
    { organic: 3, outgoing: 1, incoming: 0, adHoc: 1, operational: 1 },
    { organic: 0, outgoing: 0, incoming: 2, adHoc: 0, operational: 2 }
  ]);
  assert.equal(roster.totalOperationalPersonnel, 4);
});

test("a present person from an inactive source team is counted once when actively reinforcing an active target team", () => {
  const teams = [
    { id: "team-1", team_number: 1, name: "צוות 1", is_active: false },
    { id: "team-2", team_number: 2, name: "צוות 2", is_active: true }
  ];
  const activeReinforcements = mapActiveOrganicTeamReinforcements([{
    id: "inactive-source-to-active-target",
    unit_personnel_id: "regular-transfer",
    manual_personnel_id: null,
    source_team_id: "team-1",
    source_team_number: 1,
    destination_team_id: "team-2",
    destination_team_number: 2,
    notes: null,
    assigned_at: "2026-10-12T10:00:00Z"
  }], teams).activeReinforcements;
  const roster = calculateOperationalTeamRoster({
    teams,
    rosterPersonnel: [{ key: "roster:regular-transfer", department: "team_1", attendanceStatus: "present" }],
    manualPersonnel: [],
    activeReinforcements,
    activeAdHocMemberKeys: new Set()
  });

  assert.deepEqual(roster.teams.map((team) => team.team.number), [2]);
  assert.deepEqual(roster.teams[0], {
    team: { id: "team-2", number: 2, name: "צוות 2", isActive: true },
    organicPresent: 0,
    outgoingReinforcements: 0,
    incomingReinforcements: 1,
    adHocMembers: 0,
    operationalPersonnel: 1
  });
  assert.equal(roster.totalOperationalPersonnel, 1);
});

test("personnel page reads active reinforcements, retains inactive organic source teams, and surfaces non-compatibility load errors", () => {
  const page = fs.readFileSync(
    path.resolve(__dirname, "../app/(protected)/incidents/[incidentId]/personnel/page.tsx"),
    "utf8"
  );

  assert.match(page, /from\("incident_organic_team_reinforcements"\)/);
  assert.match(page, /\.eq\("is_active", true\)/);
  assert.match(page, /\.in\("team_number", \[1, 2, 3, 4\]\)/);
  assert.match(page, /mapActiveOrganicTeamReinforcements\(reinforcementRows, organicTeams\)/);
  assert.match(page, /byUnitPersonnelId\.get\(row\.id\)/);
  assert.match(page, /byManualPersonnelId\.get\(row\.id\)/);
  assert.match(page, /organicTeamReinforcementLoadError/);
  assert.match(page, /לא ניתן לטעון את נתוני התגבור האורגני/);
  assert.match(page, /isOperationalTeamRosterDataAvailable/);
  assert.match(page, /מצבת כוח האדם המבצעית אינה זמינה כעת – לא ניתן לטעון את כל הנתונים הנדרשים/);
  assert.match(page, /personnelError/);
  assert.match(page, /attendanceError/);
  assert.match(page, /organicTeamsError/);
  assert.match(page, /manualPersonnelError/);
  assert.match(page, /adHocMembersError/);
  assert.match(page, /incidentLifecycleAvailable/);
  assert.match(page, /לא ניתן לטעון את מצב האירוע, ולכן לא ניתן לנהל תגבור אורגני כעת/);
  assert.match(page, /select\("id,name,lifecycle_status,is_closed,archived_at"\)/);
  assert.doesNotMatch(page, /id,name,status,lifecycle_status/);
});
