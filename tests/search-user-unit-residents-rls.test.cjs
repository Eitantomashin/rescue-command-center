const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261005140000_search_user_unit_residents_select.sql"),
  "utf8"
);

test("unit-resident SELECT retains incident readers and admits only the scoped Search Site path", () => {
  assert.match(migration, /drop policy if exists unit_residents_member_select on public\.unit_residents/i);
  assert.match(migration, /create policy unit_residents_member_select\s+on public\.unit_residents for select/s);
  assert.match(migration, /public\.can_read_incident\(incident_id\)\s+or\s+public\.can_view_search_site\(site_id\)/s);
});

test("the Search Site path is tied to the resident row site and does not alter mutations", () => {
  assert.match(migration, /can_view_search_site\(site_id\)/);
  assert.doesNotMatch(migration, /for\s+(insert|update|delete|all)\b/i);
  assert.doesNotMatch(migration, /unit_residents_operator_mutate/i);
  assert.doesNotMatch(migration, /grant\s+/i);
});

test("the prior select policy had only incident-level access", () => {
  const original = fs.readFileSync(
    path.join(root, "supabase/migrations/20260610165200_phase1_rls_policies.sql"),
    "utf8"
  );
  assert.match(original, /create policy unit_residents_member_select\s+on public\.unit_residents for select\s+using \(public\.can_read_incident\(incident_id\)\)/s);
});
