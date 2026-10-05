const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261005120000_unified_search_evacuation_foundation.sql"), "utf8");

function load(relative, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(output, { module: mod, exports: mod.exports, require: (name) => dependencies[name], Set });
  return mod.exports;
}

const casualty = load("lib/search-casualty-person.ts");
const status = load("lib/search-site-status.ts");
const kpis = load("lib/search-operational-kpis.ts", { "@/lib/search-site-status": status, "@/lib/search-casualty-person": casualty });

test("generic evacuation covers every casualty while preserving the casualty classification", () => {
  for (const residentStatus of ["anxiety_casualty", "physical_casualty", "deceased"]) {
    assert.equal(casualty.searchEvacuationState({ status: residentStatus, requiresEvacuation: false, evacuatedAt: null }), "not_required");
    assert.equal(casualty.searchEvacuationState({ status: residentStatus, requiresEvacuation: true, evacuatedAt: null }), "waiting");
    assert.equal(casualty.searchEvacuationState({ status: residentStatus, requiresEvacuation: true, evacuatedAt: "2026-10-05T12:00:00Z" }), "evacuated");
  }
});

test("waiting evacuation is an overlapping person KPI", () => {
  const people = ["anxiety_casualty", "physical_casualty", "deceased"].map((residentStatus, index) => ({
    residentId: String(index), unitId: "unit", floorNumber: 1, unitNumber: "1", firstName: "דייר", lastName: null,
    status: residentStatus, requiresEvacuation: true, evacuatedAt: null, casualtiesResolved: false
  }));
  const units = [{ unitId: "unit", floorNumber: 1, unitLabel: "דירה 1", status: "casualties", casualtiesResolved: false, hasApartmentDamage: false, apartmentDamageNotes: null }];
  const findings = kpis.searchOperationalKpiCollections(units, people).findings;
  assert.equal(findings.anxiety.length, 1);
  assert.equal(findings.physical.length, 1);
  assert.equal(findings.deceased.length, 1);
  assert.equal(findings.waitingEvacuation.length, 3);
  people[1].evacuatedAt = "2026-10-05T12:00:00Z";
  const afterEvacuation = kpis.searchOperationalKpiCollections(units, people).findings;
  assert.equal(afterEvacuation.waitingEvacuation.length, 2);
  assert.equal(afterEvacuation.physical.length, 1);
});

test("migration establishes the canonical field, synchronizes legacy physical compatibility, and protects completion", () => {
  assert.match(migration, /add column if not exists requires_evacuation boolean not null default false/);
  assert.match(migration, /set requires_evacuation = coalesce\(requires_medical_evacuation, false\)/);
  assert.match(migration, /v_status_key in \('anxiety_casualty','physical_casualty','deceased'\) and v_requires_evacuation/);
  assert.match(migration, /requires_medical_evacuation=v_status_key='physical_casualty' and v_requires_evacuation/);
  assert.match(migration, /p_action='complete_casualties' and exists/s);
  assert.match(migration, /ur\.requires_evacuation=true and ur\.evacuated_at is null/);
  assert.match(migration, /לא ניתן לסיים טיפול בנפגעים כל עוד קיים דייר הממתין לפינוי/);
  assert.match(migration, /לא ניתן להוציא מהרשימה הפעילה דייר הממתין לפינוי/);
  assert.doesNotMatch(migration, /set evacuated_at\s*=\s*null/i);
});

test("generic evacuation RPC keeps permission, validation, idempotency, and one atomic event", () => {
  for (const pattern of [/security definer/, /set search_path = public/, /v_actor_id := public\.current_actor_id\(\)/, /for update of ur/, /assert_edit_search_site_data/, /if not v_is_active then/, /v_status_key not in \('anxiety_casualty','physical_casualty','deceased'\)/, /if not v_requires_evacuation then/, /if v_existing_evacuated_at is not null then return v_existing_evacuated_at;/, /and evacuated_at is null/, /'search_resident_evacuated'/, /'דייר פונה'/, /'resident_status',v_status_key/, /'requires_evacuation',v_requires_evacuation/, /revoke all on function public\.mark_search_resident_evacuated\(uuid\) from public/, /grant execute on function public\.mark_search_resident_evacuated\(uuid\) to authenticated/]) {
    assert.match(migration, pattern);
  }
  assert.doesNotMatch(migration, /search_resident_medically_evacuated/);
});

test("all resident loaders and card controls use the canonical generic field", () => {
  const files = [
    "app/mobile/search/[incidentId]/[siteId]/page.tsx",
    "app/mobile/search/mobile-search-ui.tsx",
    "app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx",
    "app/(protected)/incidents/[incidentId]/page.tsx",
    "app/(protected)/incidents/[incidentId]/search-sites-widget-data/route.ts",
    "app/mobile/search/search-unit-card.tsx"
  ].map((relative) => fs.readFileSync(path.join(root, relative), "utf8"));
  for (const source of files) assert.match(source, /requires_evacuation/);
  const card = files.at(-1);
  assert.match(card, /נדרש פינוי\?/);
  assert.match(card, /לא ניתן לסיים טיפול בנפגעים כל עוד קיים דייר הממתין לפינוי/);
});
