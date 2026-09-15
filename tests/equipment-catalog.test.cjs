// No database access: execute the real validators, actions and page with mocks.
// Run: node --test tests/equipment-catalog.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../app/(protected)/admin/equipment');

function load(name, mocks = {}) {
  const filename = path.join(root, name);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX
  } }).outputText;
  const module = { exports: {} };
  const requireMock = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.endsWith('.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    if (id.startsWith('./')) return load(`${id.slice(2)}.ts`, mocks);
    return require(id);
  };
  vm.runInNewContext(output, {
    module, exports: module.exports, require: requireMock, FormData, Error,
    console: { error() {} }, Map, Set
  }, { filename });
  return module.exports;
}

const model = load('catalog-model.ts');
const validation = load('catalog-validation.ts');
const typeId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
function form(values) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, String(value));
  return result;
}
function typeForm(overrides = {}) {
  return form({ name: 'גנרטור', category: 'חשמל', runtimeHours: 2, runtimeMinutes: 15,
    warningMinutes: 30, isActive: true, ...overrides });
}
function itemForm(overrides = {}) {
  return form({ equipmentTypeId: typeId, assetIdentifier: 'גנרטור 1', serviceability: 'serviceable',
    isActive: true, ...overrides });
}
function environment({ allowed = true, user = { id: 'admin' }, error = null, permissionError = null } = {}) {
  const calls = [];
  const refreshed = [];
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return name === 'equipment_catalog_admin' ? { data: allowed, error: permissionError } : { data: error ? null : itemId, error };
    },
    from: () => { throw new Error('Actions must never write directly to tables'); }
  };
  const mocks = {
    '@/lib/supabase/server': { createClient: () => client },
    'next/cache': { revalidatePath: (value) => refreshed.push(value) }
  };
  return { actions: load('actions.ts', mocks), calls, refreshed, mocks, client };
}

test('hours/minutes convert to RPC seconds on the server', () => {
  const result = validation.equipmentTypePayload(typeForm());
  assert.equal(result.p_full_runtime_seconds, 8100);
  assert.equal(result.p_warning_before_seconds, 1800);
});
test('unchanged legacy durations with partial minutes retain their seconds', () => {
  const result = validation.equipmentTypePayload(typeForm({ runtimeHours: 1, runtimeMinutes: 1 / 60, warningMinutes: 61 / 60 }));
  assert.equal(result.p_full_runtime_seconds, 3601);
  assert.equal(result.p_warning_before_seconds, 61);
});
test('invalid durations and oversized warning return Hebrew validation errors', () => {
  for (const values of [{ runtimeHours: 0, runtimeMinutes: 0 }, { warningMinutes: 136 },
    { warningMinutes: 0 }, { runtimeHours: '-1' }, { runtimeHours: '1x' },
    { runtimeHours: 1.5 }, { runtimeMinutes: 60 }, { warningMinutes: 'Infinity' }]) {
    assert.throws(() => validation.equipmentTypePayload(typeForm(values)), /[א-ת]/);
  }
  assert.throws(() => validation.equipmentTypePayload(typeForm({ warningMinutes: 136 })), /גדול מזמן העבודה/);
});
test('all three serviceability values accepted; invalid values rejected', () => {
  for (const state of Object.keys(model.serviceabilityLabels)) {
    assert.equal(validation.equipmentItemPayload(itemForm({ serviceability: state })).p_serviceability, state);
  }
  assert.throws(() => validation.equipmentItemPayload(itemForm({ serviceability: 'needs_refuel' })), /כשירות/);
  assert.throws(() => validation.equipmentItemPayload(itemForm({ assetIdentifier: '  ' })), /כינוי/);
});
test('deactivation and reactivation pass an explicit boolean to the RPC', () => {
  for (const isActive of [true, false]) {
    assert.equal(validation.equipmentTypePayload(typeForm({ isActive })).p_is_active, isActive);
    assert.equal(validation.equipmentItemPayload(itemForm({ isActive })).p_is_active, isActive);
  }
  assert.throws(() => validation.equipmentItemPayload(itemForm({ isActive: 'invalid' })), /מצב/);
});
test('admin create/update selects exactly the four installed RPCs', async () => {
  const env = environment();
  assert.equal((await env.actions.saveEquipmentType(typeForm())).ok, true);
  assert.equal((await env.actions.saveEquipmentType(typeForm({ id: typeId, isActive: false }))).ok, true);
  assert.equal((await env.actions.saveEquipmentItem(itemForm())).ok, true);
  assert.equal((await env.actions.saveEquipmentItem(itemForm({ id: itemId, serviceability: 'restricted' }))).ok, true);
  assert.deepEqual(env.calls.filter((call) => call.payload).map((call) => call.name), [
    'create_equipment_type', 'update_equipment_type', 'create_equipment_item', 'update_equipment_item'
  ]);
  assert.equal(env.calls.find((call) => call.name === 'create_equipment_type').payload.p_full_runtime_seconds, 8100);
  assert.deepEqual(env.refreshed, Array(4).fill('/admin/equipment'));
});
test('server actions deny non-admin, inactive/deleted profile verdict and missing session', async () => {
  for (const options of [{ allowed: false }, { allowed: null }, { user: null }, { allowed: true, permissionError: { code: 'error' } }]) {
    const env = environment(options);
    assert.equal((await env.actions.saveEquipmentType(typeForm())).ok, false);
    assert.equal((await env.actions.saveEquipmentItem(itemForm())).ok, false);
    assert.equal(env.calls.filter((call) => call.payload).length, 0);
    assert.equal(env.refreshed.length, 0);
  }
});
test('invalid warning never reaches a write RPC or returns success', async () => {
  const env = environment();
  const result = await env.actions.saveEquipmentType(typeForm({ warningMinutes: 200 }));
  assert.equal(result.ok, false);
  assert.match(result.message, /גדול מזמן העבודה/);
  assert.equal(env.calls.length, 1);
  assert.equal(env.refreshed.length, 0);
});
test('actual duplicate RPC error is translated, without success or revalidation', async () => {
  const env = environment({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
  const result = await env.actions.saveEquipmentItem(itemForm());
  assert.equal(result.ok, false);
  assert.match(result.message, /כבר קיים פריט/);
  assert.equal(env.refreshed.length, 0);
});
test('other RPC failures remain failures and have Hebrew messages', async () => {
  for (const code of ['42501', '23503', '23502', '23514', 'P0002', 'PGRST202', 'P0001']) {
    const env = environment({ error: { code, message: 'technical error' } });
    const result = await env.actions.saveEquipmentType(typeForm());
    assert.equal(result.ok, false);
    assert.match(result.message, /[א-ת]/);
    assert.doesNotMatch(result.message, /technical error/);
    assert.equal(env.refreshed.length, 0);
  }
});

const types = [{ id: typeId, name: 'גנרטור', category: 'חשמל', is_active: true, full_runtime_seconds: 7200, warning_before_seconds: 1800 }];
const items = [
  { id: itemId, equipment_type_id: typeId, asset_identifier: 'gen 01', serial_number: 'AB-12', is_active: true, serviceability: 'serviceable' },
  { id: '2', equipment_type_id: typeId, asset_identifier: 'gen 02', serial_number: null, is_active: false, serviceability: 'unserviceable' },
  { id: '3', equipment_type_id: 'other', asset_identifier: 'light', serial_number: 'AB-13', is_active: true, serviceability: 'restricted' }
];
const filters = { query: '', typeId: '', active: '', serviceability: '' };
test('search matches normalized identifier and serial number', () => {
  assert.equal(model.filterEquipmentItems(items, { ...filters, query: ' GEN   01 ' })[0].id, itemId);
  assert.equal(model.filterEquipmentItems(items, { ...filters, query: 'ab-12' })[0].id, itemId);
  assert.equal(model.filterEquipmentItems(items, { ...filters, query: 'missing' }).length, 0);
});
test('combined type, serviceability and activity filtering', () => {
  assert.equal(model.filterEquipmentItems(items, { ...filters, typeId, serviceability: 'unserviceable', active: 'inactive' })[0].id, '2');
  assert.equal(model.filterEquipmentItems(items, { ...filters, active: 'active' }).length, 2);
  assert.equal(model.filterEquipmentItems(items, { ...filters, serviceability: 'restricted' }).length, 1);
});
test('summary counts activity and serviceability independently', () => {
  const summary = model.catalogSummary(types, items);
  assert.equal(summary.activeTypes, 1);
  assert.equal(summary.activeItems, 2);
  assert.equal(summary.unserviceable, 1);
  assert.equal(summary.inactiveItems, 1);
});
test('direct page access refuses non-admin before reading catalog tables', async () => {
  const env = environment({ allowed: false });
  const page = load('page.tsx', { ...env.mocks,
    'next/navigation': { notFound: () => { throw new Error('NOT_FOUND'); } },
    './equipment-catalog': { EquipmentCatalog: () => null }
  });
  await assert.rejects(page.default(), /NOT_FOUND/);
});
test('admin page loads catalog and renders component', async () => {
  const env = environment();
  env.client.from = (table) => ({ select: () => ({ order: () => ({ range: async () => ({ data: table === 'equipment_types' ? [...types] : [...items], error: null }) }) }) });
  const page = load('page.tsx', { ...env.mocks,
    'next/navigation': { notFound: () => { throw new Error('NOT_FOUND'); } },
    './equipment-catalog': { EquipmentCatalog: () => null }
  });
  const result = await page.default();
  assert.equal(result.props.types.length, 1);
  assert.equal(result.props.items.length, 3);
});
test('server rendering has Hebrew labels, RTL, both sections and text badges', () => {
  const component = load('equipment-catalog.tsx', {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    './actions': { saveEquipmentItem() {}, saveEquipmentType() {} },
    '@/app/(protected)/operational-loading-button': { OperationalLoadingButton: () => null }
  });
  const html = renderToStaticMarkup(React.createElement(component.EquipmentCatalog, { types, items }));
  for (const value of ['dir="rtl"', 'סוגי ציוד', 'פריטי ציוד', 'כשיר', 'כשירות מוגבלת', 'לא כשיר', 'מושבת', 'מספר סידורי']) assert.ok(html.includes(value), value);
  assert.ok(!html.includes('<table'));
});
