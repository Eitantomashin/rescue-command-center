const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
function load(relative, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(output, { module: mod, exports: mod.exports, require: (name) => dependencies[name], Set });
  return mod.exports;
}
const status = load("lib/search-site-status.ts");
const casualty = load("lib/search-casualty-person.ts");
const kpis = load("lib/search-operational-kpis.ts", { "@/lib/search-site-status": status, "@/lib/search-casualty-person": casualty });
const units = ["not_visited", "in_progress", "no_answer", "clear", "casualties", "completed"].map((status, index) => ({ unitId: String(index), floorNumber: 1, unitLabel: `דירה ${index + 1}`, status, casualtiesResolved: status === "completed", hasApartmentDamage: index === 1, apartmentDamageNotes: index === 1 ? "סדק" : null }));
const people = [
  { residentId: "a", unitId: "4", floorNumber: 1, unitNumber: "5", firstName: "חרדה", lastName: null, status: "anxiety_casualty", requiresMedicalEvacuation: false, casualtiesResolved: false },
  { residentId: "p", unitId: "4", floorNumber: 1, unitNumber: "5", firstName: "גוף", lastName: null, status: "physical_casualty", requiresMedicalEvacuation: true, evacuatedAt: null, casualtiesResolved: false },
  { residentId: "d", unitId: "4", floorNumber: 1, unitNumber: "5", firstName: "חלל", lastName: null, status: "deceased", requiresMedicalEvacuation: false, casualtiesResolved: false },
  { residentId: "e", unitId: "5", floorNumber: 1, unitNumber: "6", firstName: "פונה", lastName: null, status: "physical_casualty", requiresMedicalEvacuation: true, evacuatedAt: "2026-10-01T00:00:00Z", casualtiesResolved: true }
];

test("process collections are exclusive, exhaustive, and include casualties as in progress", () => {
  const collections = kpis.searchOperationalKpiCollections(units, people);
  assert.equal(collections.process.total.length, 6);
  assert.equal(collections.process.notStarted.length, 1);
  assert.equal(collections.process.inProgress.length, 2);
  assert.equal(collections.process.noAnswer.length, 1);
  assert.equal(collections.process.completed.length, 2);
  assert.equal(collections.process.notStarted.length + collections.process.inProgress.length + collections.process.noAnswer.length + collections.process.completed.length, collections.process.total.length);
});
test("findings keep apartment and person units of measure separate", () => {
  const findings = kpis.searchOperationalKpiCollections(units, people).findings;
  assert.equal(findings.cleared.length, 2);
  assert.equal(findings.damaged.length, 1);
  assert.equal(findings.damaged[0].apartmentDamageNotes, "סדק");
  assert.equal(findings.openCasualties.length, 1);
  assert.equal(findings.resolvedCasualties.length, 1);
  assert.equal(findings.anxiety.length, 1);
  assert.equal(findings.physical.length, 2);
  assert.equal(findings.deceased.length, 1);
  assert.equal(findings.waitingEvacuation.length, 1);
  assert.equal(findings.waitingEvacuation[0].residentId, "p");
  assert.equal(findings.physical.some((person) => person.residentId === "e"), true);
  assert.equal(findings.physical.some((person) => person.status === "deceased"), false);
});
test("all three surfaces mount the shared read-only operational KPI renderer", () => {
  for (const relative of ["app/mobile/search/mobile-search-ui.tsx", "app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx", "app/(protected)/incidents/[incidentId]/search-sites-dashboard-widget.tsx"]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /SearchOperationalKpis/);
    assert.doesNotMatch(source, /mark_search_resident_evacuated/);
  }
});

test("protected loader retains the active flag and evacuation fields used by the canonical person model", () => {
  const protectedPage = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx"), "utf8");
  const commanderPage = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/page.tsx"), "utf8");
  assert.match(protectedPage, /notes,is_active,requires_medical_evacuation,evacuated_at,status_types!inner\(status_key\)/);
  assert.match(protectedPage, /residentStatusKeyFromEmbeddedStatus\(row\.status_types\)/);
  assert.match(protectedPage, /isActiveSearchCasualtyPerson\(\{ isActive: resident\.is_active, status: resident\.status_key \}\)/);
  assert.match(commanderPage, /is_active,requires_medical_evacuation,evacuated_at/);

  const protectedPeople = people.filter((person) => casualty.isActiveSearchCasualtyPerson({ isActive: true, status: person.status }));
  const protectedFindings = kpis.searchOperationalKpiCollections(units, protectedPeople).findings;
  assert.equal(protectedFindings.deceased.length, 1);
  assert.equal(protectedFindings.physical.some((person) => person.status === "deceased"), false);
  assert.equal(protectedFindings.waitingEvacuation.length, 1);
  assert.equal(protectedFindings.physical.length, 2);
});
