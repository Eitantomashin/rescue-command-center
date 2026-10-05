const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function loadTs(relativePath) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Set });
  return mod.exports;
}
const status = loadTs('lib/search-site-status.ts');
const casualty = loadTs('lib/search-casualty-person.ts');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261004160000_search_progress_medical_evacuation_foundation.sql'), 'utf8');

test('each persisted search status has exactly one canonical process category', () => {
  const statuses = ['not_visited', 'in_progress', 'no_answer', 'clear', 'casualties', 'completed'];
  const categories = statuses.map((value) => status.searchProcessCategory(value));
  assert.deepEqual(categories, ['not_visited', 'in_progress', 'no_answer', 'completed', 'in_progress', 'completed']);
  assert.equal(new Set(categories).size, 4);
});

test('process partition covers all valid statuses and findings remain independent', () => {
  for (const value of ['not_visited', 'in_progress', 'no_answer', 'clear', 'casualties', 'completed']) {
    assert.ok(['not_visited', 'in_progress', 'no_answer', 'completed'].includes(status.searchProcessCategory(value)));
  }
  assert.equal(status.isClearedSearchUnit('clear'), true);
  assert.equal(status.isClearedSearchUnit('completed'), true);
  assert.equal(status.hasSearchApartmentDamage(true), true);
  assert.equal(status.hasSearchApartmentDamage(false), false);
  assert.equal(status.isOpenSearchCasualtyUnit('casualties', false), true);
  assert.equal(status.isResolvedSearchCasualtyUnit('completed', true), true);
  assert.equal(status.isResolvedSearchCasualtyUnit('casualties', true), true);
});

test('canonical evacuation state applies to every casualty requiring evacuation', () => {
  const base = { residentId: 'r', unitId: 'u', floorNumber: 1, unitNumber: '1', firstName: '', lastName: null, casualtiesResolved: false };
  assert.equal(casualty.searchEvacuationState({ ...base, status: 'physical_casualty', requiresEvacuation: true, evacuatedAt: null }), 'waiting');
  assert.equal(casualty.searchEvacuationState({ ...base, status: 'physical_casualty', requiresEvacuation: true, evacuatedAt: '2026-10-04T10:00:00Z' }), 'evacuated');
  assert.equal(casualty.searchEvacuationState({ ...base, status: 'physical_casualty', requiresEvacuation: false, evacuatedAt: null }), 'not_required');
  assert.equal(casualty.searchEvacuationState({ ...base, status: 'anxiety_casualty', requiresEvacuation: true, evacuatedAt: null }), 'waiting');
});

test('migration persists in-progress work, preserves evacuation history, and makes evacuation audited and idempotent', () => {
  assert.match(migration, /'not_visited', 'in_progress', 'no_answer', 'clear', 'casualties', 'completed'/);
  assert.match(migration, /add column if not exists evacuated_at timestamptz null/);
  assert.match(migration, /then v_new_status:='in_progress'; end if/);
  assert.match(migration, /create or replace function public\.mark_search_resident_evacuated\(p_resident_id uuid\)/);
  assert.doesNotMatch(migration, /into v_resident, v_site, v_unit, v_status_key/);
  assert.match(migration, /into v_resident_id, v_incident_id, v_site_id, v_unit_id, v_floor_id,/);
  assert.match(migration, /for update of ur/);
  assert.match(migration, /if not v_is_active then/);
  assert.match(migration, /if v_status_key <> 'physical_casualty' then/);
  assert.match(migration, /if not v_requires_medical_evacuation then/);
  assert.match(migration, /if v_existing_evacuated_at is not null then\s+return v_existing_evacuated_at;/s);
  assert.match(migration, /and evacuated_at is null/);
  assert.match(migration, /'search_resident_medically_evacuated'/);
  assert.match(migration, /assert_edit_search_site_data/);
  assert.match(migration, /revoke all on function public\.mark_search_resident_evacuated\(uuid\) from public/);
  assert.doesNotMatch(migration, /set evacuated_at\s*=\s*null/i);
});
