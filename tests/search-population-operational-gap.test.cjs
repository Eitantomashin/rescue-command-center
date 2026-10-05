const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "lib/search-population-operational-gap.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(output, { module: mod, exports: mod.exports });
const population = mod.exports;
const clear = { isActive: true, statusKey: "resident_clear", requiresEvacuation: false, evacuatedAt: null };
const casualty = (statusKey, requiresEvacuation = false, evacuatedAt = null) => ({ isActive: true, statusKey, requiresEvacuation, evacuatedAt });

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("known population is canonical and four cleared residents close a unit", () => {
  assert.deepEqual(plain(population.searchUnitPopulationMetrics(4, [clear, clear, clear, clear], false)), {
    updatedPotential: 4, closedPeople: 4, operationalGap: 0, populationUnknown: false
  });
});

test("unresolved casualties remain in the operational gap", () => {
  const residents = [clear, clear, casualty("physical_casualty"), casualty("physical_casualty")];
  assert.equal(population.searchUnitPopulationMetrics(4, residents, false).operationalGap, 2);
  assert.equal(population.searchUnitPopulationMetrics(4, [clear, clear, casualty("physical_casualty", true, "2026-10-05T10:00:00Z"), casualty("physical_casualty", true, "2026-10-05T10:00:00Z")], false).operationalGap, 2);
});

test("resolved casualties close only after apartment treatment completes and required evacuation has occurred", () => {
  const residents = [clear, clear, casualty("anxiety_casualty", true), casualty("deceased", true, "2026-10-05T10:00:00Z")];
  assert.equal(population.searchUnitPopulationMetrics(4, residents, true).operationalGap, 1);
  residents[2].evacuatedAt = "2026-10-05T10:00:00Z";
  assert.equal(population.searchUnitPopulationMetrics(4, residents, true).operationalGap, 0);
});

test("zero and unknown population remain distinct", () => {
  assert.deepEqual(plain(population.searchUnitPopulationMetrics(0, [clear], false)), {
    updatedPotential: 0, closedPeople: 0, operationalGap: 0, populationUnknown: false
  });
  assert.deepEqual(plain(population.searchUnitPopulationMetrics(null, [clear], true)), {
    updatedPotential: 0, closedPeople: 0, operationalGap: 0, populationUnknown: true
  });
});

test("closed rows are capped at scanner-reported population and site aggregation is additive", () => {
  const first = population.searchUnitPopulationMetrics(2, [clear, clear, clear], true);
  const second = population.searchUnitPopulationMetrics(4, [clear, casualty("physical_casualty")], false);
  assert.equal(first.closedPeople, 2);
  assert.equal(first.operationalGap, 0);
  assert.equal(first.operationalGap + second.operationalGap, 3);
});

test("migration branches Search Sites while retaining Rescue Site legacy formula and aggregates incidents from site values", () => {
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261005130000_search_population_operational_gap.sql"), "utf8");
  assert.match(migration, /search_site\.site_type = 'search_site'/);
  assert.match(migration, /u\.known_people_count is not null/);
  assert.match(migration, /resident_status\.status_key = 'resident_clear'/);
  assert.match(migration, /coalesce\(ssu\.casualties_resolved, false\) = true/);
  assert.match(migration, /coalesce\(ur\.requires_evacuation, false\) = false or ur\.evacuated_at is not null/);
  assert.match(migration, /case when s\.site_type = 'search_site' then coalesce\(sp\.updated_potential, 0\) else coalesce\(rp\.updated_potential, 0\) end/);
  assert.match(migration, /else greatest\(coalesce\(rp\.updated_potential, 0\) - coalesce\(onm\.active_operational_numbers_count, 0\), 0\) end/);
  assert.match(migration, /from public\.site_dashboard_summary/);
  assert.match(migration, /coalesce\(sum\(operational_gap\), 0\)::integer as operational_gap/);
});

test("commander KPI rows explicitly separate process, apartment findings, and people evacuation", () => {
  const renderer = fs.readFileSync(path.join(root, "app/mobile/search/search-operational-kpis.tsx"), "utf8");
  assert.match(renderer, /label="סטטוס הסריקה"/);
  assert.match(renderer, /label="ממצאים בדירות"/);
  assert.match(renderer, /label="תמונת נפגעים ופינוי"/);
  const findings = renderer.slice(renderer.indexOf('label="ממצאים בדירות"'), renderer.indexOf('label="תמונת נפגעים ופינוי"'));
  assert.doesNotMatch(findings, /נפגעי חרדה|נפגעי גוף|חללים|ממתינים לפינוי/);
  const people = renderer.slice(renderer.indexOf('label="תמונת נפגעים ופינוי"'));
  for (const label of ["נפגעי חרדה", "נפגעי גוף", "חללים", "ממתינים לפינוי"]) assert.match(people, new RegExp(label));
});

test("operational gap drilldown lists open residents, excludes closed residents, and represents unidentified people", () => {
  const result = population.searchOperationalGapDrilldown([
    {
      unitId: "u1", siteName: "אתר", floorNumber: 2, unitLabel: "דירה 7", knownPeopleCount: 5, casualtiesResolved: false,
      residents: [
        { ...clear, residentId: "clear", firstName: "סגור", lastName: null },
        { ...casualty("anxiety_casualty"), residentId: "anxiety", firstName: "חרדה", lastName: null },
        { ...casualty("physical_casualty", true), residentId: "waiting", firstName: "פינוי", lastName: null },
        { ...casualty("deceased", true, "2026-10-05T10:00:00Z"), residentId: "treatment", firstName: "טיפול", lastName: null }
      ]
    }
  ]);
  assert.equal(result.total, 4);
  assert.equal(result.entries.some((entry) => entry.residentId === "clear"), false);
  assert.equal(result.entries.some((entry) => entry.residentId === "anxiety"), true);
  assert.equal(result.entries.find((entry) => entry.residentId === "waiting").reason, "ממתין לפינוי");
  assert.equal(result.entries.find((entry) => entry.residentId === "treatment").reason, "טיפול בנפגעים טרם הסתיים");
  const unidentified = result.entries.find((entry) => entry.kind === "unidentified");
  assert.equal(unidentified.representedCount, 1);
  assert.equal(unidentified.reason, "טרם זוהו/הוזנו פרטי הדיירים");
});

test("resolved casualties no longer appear in the gap drilldown", () => {
  const result = population.searchOperationalGapDrilldown([{
    unitId: "u2", siteName: "אתר", floorNumber: 1, unitLabel: "דירה 2", knownPeopleCount: 2, casualtiesResolved: true,
    residents: [
      { ...casualty("physical_casualty", false), residentId: "resolved", firstName: "נסגר", lastName: null },
      { ...casualty("deceased", true, "2026-10-05T10:00:00Z"), residentId: "evacuated", firstName: "פונה", lastName: null }
    ]
  }]);
  assert.equal(result.total, 0);
  assert.equal(result.entries.length, 0);
});

test("commander initial data and polling use the same operational-gap helper and payload field", () => {
  const initial = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/page.tsx"), "utf8");
  const polling = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/search-sites-widget-data/route.ts"), "utf8");
  const widget = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/search-sites-dashboard-widget.tsx"), "utf8");
  for (const source of [initial, polling]) {
    assert.match(source, /searchOperationalGapDrilldown/);
    assert.match(source, /knownPeopleCount: unit\.known_people_count/);
    assert.match(source, /casualtiesResolved:/);
    assert.match(source, /requiresEvacuation:/);
    assert.match(source, /evacuatedAt:/);
  }
  assert.match(widget, /SearchOperationalGapKpiCard/);
  assert.match(widget, /operationalGapEntries/);
  assert.doesNotMatch(widget, /search-site-metrics-heading/);
  for (const label of ["סטטוס הסריקה", "ממצאים בדירות", "תמונת נפגעים ופינוי"]) assert.match(widget, new RegExp(`SearchSiteKpiRow label=\"${label}\"`));
});
