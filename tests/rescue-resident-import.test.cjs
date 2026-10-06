const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261005160000_rescue_resident_import_unit_population.sql"), "utf8");
const uuidLookupFix = fs.readFileSync(path.join(root, "supabase/migrations/20261006100000_fix_rescue_resident_import_uuid_unit_lookup.sql"), "utf8");
const sitePage = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx"), "utf8");
const summaries = fs.readFileSync(path.join(root, "supabase/migrations/20261005130000_search_population_operational_gap.sql"), "utf8");
function reconcile(planned, imported) {
  const residents = Array.from({ length: planned }, () => ({ placeholder: true, active: true }));
  for (let index = 0; index < imported; index += 1) {
    const placeholder = residents.find((resident) => resident.active && resident.placeholder);
    if (placeholder) placeholder.placeholder = false; else residents.push({ placeholder: false, active: true });
  }
  for (const resident of residents) if (resident.placeholder) resident.active = false;
  return residents.filter((resident) => resident.active).length;
}
test("Rescue creation restores five active placeholder residents per planned apartment", () => {
  assert.match(migration, /v_is_search_site boolean/i);
  assert.match(migration, /case when v_is_search_site then 0 else v_average_potential end/i);
  assert.match(migration, /if not v_is_search_site then\s+for v_resident_index in 1\.\.v_average_potential loop/s);
  assert.match(migration, /'דייר ' \|\| v_resident_index/);
  assert.equal(8 * reconcile(5, 5), 40);
});
test("Search creation remains on the post-October population path", () => {
  assert.match(migration, /set_config\('rcc\.site_creation_type', 'search_site', true\)/);
  assert.match(migration, /set_config\('rcc\.site_creation_type', '', true\)/);
});
test("Rescue reconciliation yields exactly 3, 5, or 7 active residents", () => {
  assert.equal(reconcile(5, 3), 3); assert.equal(reconcile(5, 5), 5); assert.equal(reconcile(5, 7), 7);
  assert.match(migration, /ur\.notes='placeholder'/); assert.match(migration, /set is_active=false/);
  assert.match(migration, /insert into public\.unit_residents/i);
});
test("re-import reuses a staged identity instead of duplicating resident population", () => {
  assert.match(migration, /with ordinality/);
  assert.match(migration, /order by i\.created_at,i\.id offset v_prior limit 1/);
  assert.match(migration, /join public\.unit_residents ur on ur\.id=i\.linked_resident_id/);
  assert.match(migration, /linked_resident_id=v_resident_id/);
});
test("the forward RPC fix counts matching units before selecting the only UUID", () => {
  assert.doesNotMatch(uuidLookupFix, /min\(u\.id\)/i);
  assert.match(uuidLookupFix, /select count\(\*\) into v_unit_count/);
  assert.match(uuidLookupFix, /if v_unit_count <> 1 then v_unmatched := v_unmatched \+ 1; continue; end if;/);
  assert.match(uuidLookupFix, /select u\.id into v_unit_id[\s\S]*?limit 1;/);
  assert.match(uuidLookupFix, /regexp_replace\(lower\(btrim\(f\.floor_number::text\)\), '\\s\+', '', 'g'\)/);
  assert.match(uuidLookupFix, /regexp_replace\(lower\(btrim\(u\.unit_number\)\), '\\s\+', '', 'g'\)/);
});
test("linked residents are protected and this path creates no persons or operational numbers", () => {
  assert.match(migration, /ur\.linked_person_id is null/);
  assert.doesNotMatch(migration, /insert into public\.persons/i);
  assert.doesNotMatch(migration, /operational_number/i);
});
test("initial potential stays planned while current active residents feed the existing KPI", () => {
  assert.match(migration, /v_initial_potential := v_initial_potential \+ \(v_quantity \* v_average_potential\)/);
  assert.match(summaries, /resident_potential/i); assert.match(summaries, /from public\.unit_residents ur/i);
  assert.doesNotMatch(migration, /create or replace view public\.site_dashboard_summary/i);
  assert.match(sitePage, /\.from\("unit_residents"\)/);
});
test("the RPC remains security-definer, audited, and transactional", () => {
  assert.match(migration, /create or replace function public\.import_site_residents[\s\S]*?security definer[\s\S]*?set search_path = public/s);
  assert.match(migration, /set_config\('rcc\.allow_event_log_insert','on',true\)/);
  assert.match(migration, /exception when others[\s\S]*?raise;/);
  assert.match(migration, /revoke all on function public\.import_site_residents\(uuid,jsonb\) from public, anon/);
});
