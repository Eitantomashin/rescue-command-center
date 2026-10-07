const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261007110000_search_site_report_population_attention.sql"), "utf8");
const report = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/reports/search-sites/[reportId]/page.tsx"), "utf8");

test("Search Site report snapshot captures only active residents requiring attention", () => {
  const attention = migration.slice(migration.indexOf("with attention_residents as"), migration.indexOf("v_total :="));
  assert.match(attention, /from public\.unit_residents ur/);
  assert.match(attention, /ur\.is_active = true/);
  assert.match(attention, /u\.is_active = true/);
  assert.match(attention, /resident_status\.category = 'resident'/);
  assert.match(attention, /resident_status\.status_key in \('not_checked', 'anxiety_casualty', 'physical_casualty', 'deceased'\)/);
  assert.doesNotMatch(attention, /resident_status\.status_key = 'resident_clear'/);
  for (const key of ["first_name", "last_name", "floor_number", "unit_label", "status_key", "status_label", "casualties_resolved", "requires_evacuation", "evacuated_at", "notes"]) {
    assert.match(attention, new RegExp(`'${key}'`));
  }
});

test("snapshot summary uses the established casualty-resolution and evacuation rule", () => {
  const attention = migration.slice(migration.indexOf("with attention_residents as"), migration.indexOf("v_total :="));
  assert.match(attention, /resident_status\.status_key in \('anxiety_casualty', 'physical_casualty', 'deceased'\)/);
  assert.match(attention, /coalesce\(ssu\.casualties_resolved, false\)/);
  assert.match(attention, /coalesce\(ur\.requires_evacuation, false\) = false or ur\.evacuated_at is not null/);
  for (const key of ["not_checked", "anxiety", "physical", "deceased", "waiting_evacuation", "open_treatment", "resolved_treatment"]) {
    assert.match(attention, new RegExp(`'${key}'`));
  }
  assert.match(migration, /'population_attention', v_population_attention/);
});

test("report preserves historical snapshots and renders population attention safely", () => {
  assert.match(migration, /create or replace function public\.create_search_site_report\(p_site_id uuid\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function public\.create_search_site_report\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.create_search_site_report\(uuid\) to authenticated/);
  assert.match(report, /const hasPopulationAttention = snapshot\.population_attention !== null/);
  assert.match(report, /פירוט דיירים לא נשמר בדוח היסטורי זה/);
  assert.match(report, /נפגעים ואוכלוסייה במעקב/);
  for (const column of ["שם", "קומה", "דירה", "סטטוס", "מצב טיפול", "מצב פינוי", "הערות"]) assert.match(report, new RegExp(`<th>${column}</th>`));
  assert.match(report, /residentTreatmentText/);
  assert.match(report, /residentEvacuationText/);
  assert.doesNotMatch(report, /\.from\("unit_residents"\)/);
});
