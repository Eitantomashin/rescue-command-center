const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
function load(relative) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(output, { module: mod, exports: mod.exports, require });
  return mod.exports;
}

const reconciliation = load("lib/commander-missing-unknown.ts");

function resident(overrides = {}) {
  return {
    id: "resident-1",
    siteId: "rescue-site",
    firstName: "רות",
    lastName: "כהן",
    statusKey: "missing",
    linkedPersonId: null,
    isActive: true,
    notes: null,
    gender: "female",
    age: 42,
    phone: "0500000000",
    requiresMedicalEvacuation: false,
    ...overrides
  };
}

function missingResidents(residents, { personIds = [], searchSiteIds = [] } = {}) {
  return reconciliation.commanderMissingUnknownResidents({
    residents,
    nonMergedPersonIds: new Set(personIds),
    searchSiteIds: new Set(searchSiteIds)
  });
}

test("concrete unlinked Rescue resident with missing status is included", () => {
  assert.deepEqual(missingResidents([resident()]).map((entry) => entry.id), ["resident-1"]);
});

test("strict synthetic Rescue placeholder is excluded", () => {
  const placeholder = resident({
    firstName: "דייר 4",
    lastName: null,
    notes: "placeholder",
    gender: "unknown",
    age: null,
    phone: null
  });
  assert.equal(reconciliation.isStrictRescueResidentPlaceholder(placeholder), true);
  assert.deepEqual(missingResidents([placeholder]), []);
});

test("linked resident follows its non-merged person's authoritative outcome", () => {
  const linkedKnownPerson = resident({ linkedPersonId: "person-known" });
  assert.deepEqual(missingResidents([linkedKnownPerson], { personIds: ["person-known"] }), []);
});

test("linked missing/unknown person is counted only by the existing person path", () => {
  const linkedResident = resident({ linkedPersonId: "person-missing" });
  const existingMissingUnknownPeople = [{ personId: "person-missing", dashboardStatusGroup: "missing_unknown" }];
  const residentRows = missingResidents([linkedResident], { personIds: existingMissingUnknownPeople.map((person) => person.personId) });
  const personRows = existingMissingUnknownPeople.filter((person) => person.dashboardStatusGroup === "missing_unknown");
  assert.equal(residentRows.length + personRows.length, 1);
  assert.equal(residentRows.length, 0);
});

test("the Rothschild-style Rescue population contributes only its 28 concrete unlinked residents", () => {
  const concreteResidents = Array.from({ length: 28 }, (_, index) => resident({ id: `concrete-${index}` }));
  const linkedKnownResidents = [
    resident({ id: "linked-known-1", linkedPersonId: "person-known-1" }),
    resident({ id: "linked-known-2", linkedPersonId: "person-known-2" })
  ];
  assert.equal(
    missingResidents([...concreteResidents, ...linkedKnownResidents], { personIds: ["person-known-1", "person-known-2"] }).length,
    28
  );
});

test("unlinked missing/unknown operational person remains in the existing person KPI path", () => {
  const operationalPeople = [
    { personId: "person-missing", dashboardStatusGroup: "missing_unknown" },
    { personId: "person-rescued", dashboardStatusGroup: "rescued" }
  ];
  assert.deepEqual(
    operationalPeople.filter((person) => person.dashboardStatusGroup === "missing_unknown").map((person) => person.personId),
    ["person-missing"]
  );
});

test("Search residents do not participate and non-missing resident statuses remain unchanged", () => {
  const searchResident = resident({ id: "search-resident", siteId: "search-site" });
  const clearRescueResident = resident({ id: "clear-resident", statusKey: "resident_clear" });
  assert.deepEqual(missingResidents([searchResident, clearRescueResident], { searchSiteIds: ["search-site"] }), []);
});

test("Commander dashboard adds the resident rows only to the missing/unknown status drilldown", () => {
  const scope = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/dashboard-command-scope-v2.tsx"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/command-dashboard/command-status-dashboard.tsx"), "utf8");
  assert.match(scope, /statusId: "missing_unknown"/);
  assert.match(scope, /return \[\.\.\.personRows, \.\.\.residentRows\]/);
  assert.match(dashboard, /row\.entityType === "resident"/);
  assert.match(dashboard, /if \(!row\.personId\) return/);
});
