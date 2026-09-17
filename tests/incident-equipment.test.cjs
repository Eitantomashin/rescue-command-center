// Local only: real model/actions/components with mocked Supabase and React hooks.
// node --test tests/incident-equipment.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../app/(protected)/incidents/[incidentId]/equipment');
function load(name, mocks = {}, globals = {}) {
  const file = path.join(root, name);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, FormData, Error, Date, Map, Set,
    console, require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (id.startsWith('./')) return load(`${id.slice(2)}.ts`, mocks, globals);
      return require(id);
    }, ...globals }, { filename: file });
  return module.exports;
}
const model = load('equipment-model.ts');
const validation = load('equipment-validation.ts');
const id = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const now = Date.parse('2026-09-16T12:00:00Z');
const incident = { name: 'אירוע בדיקה', lifecycle_status: 'active', is_closed: false, archived_at: null };
const row = { assignment_id: id, equipment_item_id: itemId, version: 3, cycle_id: id,
  operation_state: 'off', accumulated_active_seconds: 0, running_since: null, first_started_at: null,
  full_runtime_seconds_snapshot: 7200, warning_before_seconds_snapshot: 1800,
  asset_identifier_snapshot: 'גנרטור 1', serial_number: 'AB-12', equipment_type_id_snapshot: itemId,
  equipment_type_name_snapshot: 'גנרטור', instructions_snapshot: null, team_id: id, ad_hoc_team_id: null,
  team_name: 'אלון', location: 'שער מערבי', notes: 'בדיקה', equipment_item_is_active: true, equipment_type_is_active: true, serviceability: 'serviceable' };
const data = { server_now: new Date(now).toISOString(), equipment: [row], incident, canEdit: true,
  teams: [{ key: `regular:${id}`, label: 'אלון' }], available: [], availabilityError: null };
function form(overrides = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ incidentId: id, assignmentId: id, requestId, version: 3, equipmentItemId: itemId, team: `regular:${id}`, location: 'שער', notes: 'הערה', ...overrides })) result.set(key, String(value));
  return result;
}
test('off has full time and no elapsed passage', () => {
  assert.equal(model.equipmentTiming(row, now + 100000).remaining, 7200);
});
test('paused keeps accumulated time even after long passage', () => {
  assert.equal(model.equipmentTiming({ ...row, operation_state: 'paused', accumulated_active_seconds: 1000 }, now + 100000).remaining, 6200);
});
test('running ADDS previous accumulation to the current segment', () => {
  const timing = model.equipmentTiming({ ...row, operation_state: 'running', accumulated_active_seconds: 1000, running_since: new Date(now - 300000).toISOString() }, now);
  assert.equal(timing.elapsed, 1300);
  assert.equal(timing.remaining, 5900);
});
test('negative remaining time continues and formats with a visible minus', () => {
  const timing = model.equipmentTiming({ ...row, operation_state: 'running', accumulated_active_seconds: 7200, running_since: new Date(now - 755000).toISOString() }, now);
  assert.equal(timing.remaining, -755);
  assert.equal(model.duration(timing.remaining), '-00:12:35');
});
for (const [elapsed, state] of [[5399, 'normal'], [5400, 'warning'], [7200, 'overdue'], [7300, 'overdue']]) {
  test(`time classification boundary ${elapsed} -> ${state}`, () => {
    assert.equal(model.equipmentTiming({ ...row, operation_state: 'paused', accumulated_active_seconds: elapsed }, now).state, state);
  });
}
test('progress clamps to 0..100 and negative remaining is not clamped', () => {
  assert.equal(model.equipmentTiming(row, now).progress, 0);
  assert.equal(model.equipmentTiming({ ...row, accumulated_active_seconds: 3600 }, now).progress, 50);
  const timing = model.equipmentTiming({ ...row, accumulated_active_seconds: 8000 }, now);
  assert.equal(timing.progress, 100); assert.equal(timing.remaining, -800);
});
test('server clock uses monotonic elapsed; ignores browser wall clock', () => {
  assert.equal(model.estimateServerTime(data.server_now, 100, 2600), now + 2500);
  assert.equal(model.estimateServerTime(data.server_now, 100, 90), now);
});
test('actions follow all operation states including unstarted refuel cycle', () => {
  assert.deepEqual(Array.from(model.allowedActions(row, incident, true)), ['update', 'transfer', 'start', 'release']);
  assert.deepEqual(Array.from(model.allowedActions({ ...row, operation_state: 'running', first_started_at: data.server_now }, incident, true)), ['update', 'transfer', 'pause', 'refuel']);
  assert.deepEqual(Array.from(model.allowedActions({ ...row, operation_state: 'paused', first_started_at: data.server_now }, incident, true)), ['update', 'transfer', 'resume', 'release', 'refuel']);
  assert.deepEqual(Array.from(model.allowedActions({ ...row, operation_state: 'paused' }, incident, true)), ['update', 'transfer', 'resume', 'release']);
});
test('readonly, closed, archived, unknown lifecycle deny actions', () => {
  assert.equal(model.allowedActions(row, incident, false).length, 0);
  for (const state of [{ ...incident, is_closed: true }, { ...incident, lifecycle_status: 'closed' }, { ...incident, archived_at: data.server_now }, { ...incident, lifecycle_status: null }]) {
    assert.equal(model.allowedActions(row, state, true).length, 0); assert.equal(model.canAssign(state, true), false);
  }
});
test('paused incident permits existing operations but no allocation', () => {
  const state = { ...incident, lifecycle_status: 'paused' };
  assert.equal(model.canAssign(state, true), false);
  assert.ok(model.allowedActions(row, state, true).includes('start'));
});
test('exactly one regular or ad-hoc team is required', () => {
  assert.equal(validation.teamPayload(form()).p_ad_hoc_team_id, null);
  assert.equal(validation.teamPayload(form({ team: `ad_hoc:${id}` })).p_team_id, null);
  for (const team of ['', 'regular:no', `regular:${id}:extra`, `other:${id}`]) assert.throws(() => validation.teamPayload(form({ team })), /צוות/);
  const duplicate = form(); duplicate.append('team', `ad_hoc:${id}`);
  assert.throws(() => validation.teamPayload(duplicate), /צוות/);
});
test('invalid UUID, version, oversized input never validate', () => {
  for (const values of [{ requestId: 'bad' }, { incidentId: 'bad' }, { version: 0 }, { version: 1.1 }, { version: 'Infinity' }, { notes: 'x'.repeat(5001) }]) {
    assert.throws(() => validation.actionPayload('update', form(values)), /[א-ת]/);
  }
});
test('catalog warnings leave clock and snapshot untouched', () => {
  for (const values of [{ equipment_item_is_active: false }, { equipment_type_is_active: false }, { serviceability: 'restricted' }, { serviceability: 'unserviceable' }]) {
    const changed = { ...row, ...values }; const before = JSON.stringify(changed);
    assert.match(model.equipmentWarning(changed), /תשומת לב/);
    assert.deepEqual(model.equipmentTiming(changed, now), model.equipmentTiming(row, now));
    assert.equal(JSON.stringify(changed), before);
  }
});
const adHoc = { ...row, assignment_id: itemId, asset_identifier_snapshot: 'משאבה', team_id: null, ad_hoc_team_id: itemId, team_name: 'אור', operation_state: 'paused', accumulated_active_seconds: 6000 };
test('search and combined filters use identifier/serial/team/type/state/time', () => {
  assert.equal(model.filterEquipment([row, adHoc], { ...model.emptyFilters, query: ' ab-12 ', team: `regular:${id}` }, now).length, 1);
  assert.equal(model.filterEquipment([row, adHoc], { ...model.emptyFilters, query: 'משאבה', operation: 'paused', type: itemId, time: 'warning' }, now).length, 1);
  assert.equal(model.filterEquipment([row], { ...model.emptyFilters, query: 'missing' }, now).length, 0);
});
test('regular/ad-hoc/unassigned groups preserve all rows', () => {
  const groups = model.groupEquipment([row, adHoc, { ...row, assignment_id: requestId, team_name: null }]);
  assert.deepEqual(Array.from(groups, (group) => group.key), [`regular:${id}`, `ad_hoc:${itemId}`, 'none']);
  assert.equal(groups[2].label, 'ללא צוות');
});

function environment(options = {}) {
  const calls = [], refreshed = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: options.noUser ? null : { id } }, error: null }) },
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      if (name === 'can_read_equipment_incident') return { data: options.readable ?? true, error: null };
      if (name === 'can_edit_operational_data') return { data: options.editable ?? true, error: null };
      if (name === 'current_user_role') return { data: options.role ?? 'admin', error: null };
      if (name === 'get_incident_equipment_state') return { data: options.state ?? data, error: null };
      if (name === 'get_available_equipment_for_incident') return { data: [], error: null };
      return { data: options.error ? null : { assignment_id: id, version: 4 }, error: options.error ?? null };
    },
    from(table) {
      assert.ok(['incidents', 'teams', 'incident_ad_hoc_teams'].includes(table), 'no direct catalog access');
      const query = { select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; },
        maybeSingle: async () => ({ data: options.incident ?? incident, error: null }), range: async () => ({ data: [], error: null }) };
      return query;
    }
  };
  return { actions: load('actions.ts', { '@/lib/supabase/server': { createClient: () => client }, 'next/cache': { revalidatePath: (value) => refreshed.push(value) } }), calls, refreshed };
}
const exportedActions = ['assignEquipment', 'updateEquipmentAssignment', 'transferEquipment', 'releaseEquipment', 'startEquipment', 'pauseEquipment', 'resumeEquipment', 'confirmEquipmentRefuel'];
test('all eight server actions call exact RPCs with correct named parameters', async () => {
  const env = environment();
  for (const action of exportedActions) assert.equal((await env.actions[action](form())).ok, true);
  const writes = env.calls.filter((call) => Object.values(validation.actionRpcs).includes(call.name));
  assert.deepEqual(writes.map((call) => call.name), Object.values(validation.actionRpcs));
  assert.deepEqual(Object.keys(writes[0].payload).sort(), ['p_incident_id', 'p_request_id', 'p_equipment_item_id', 'p_team_id', 'p_ad_hoc_team_id', 'p_location', 'p_notes'].sort());
  assert.equal(writes[3].payload.p_release_reason, 'החזרת ציוד למחסני היחידה');
  assert.equal(writes[7].payload.p_expected_version, 3);
  assert.equal(env.refreshed.length, 32);
});
test('server denies inactive/unreadable, viewer, search role, no user and readonly editor', async () => {
  for (const options of [{ readable: false }, { noUser: true }, { role: 'viewer' }, { role: 'search_user' }, { editable: false }]) {
    const env = environment(options);
    for (const action of exportedActions) assert.equal((await env.actions[action](form())).ok, false);
    assert.equal(env.calls.filter((call) => Object.values(validation.actionRpcs).includes(call.name)).length, 0);
  }
});
test('server lifecycle validation matches active/paused/closed/archived rules', async () => {
  const paused = environment({ incident: { ...incident, lifecycle_status: 'paused' } });
  assert.equal((await paused.actions.assignEquipment(form())).ok, false);
  assert.equal((await paused.actions.startEquipment(form())).ok, true);
  for (const state of [{ ...incident, lifecycle_status: 'closed' }, { ...incident, archived_at: data.server_now }]) {
    const env = environment({ incident: state });
    for (const action of exportedActions) assert.equal((await env.actions[action](form())).ok, false);
  }
});
test('stale version refreshes and never reports success or revalidates', async () => {
  const env = environment({ error: { code: '40001', message: 'internal' } });
  const result = await env.actions.startEquipment(form());
  assert.equal(result.ok, false); assert.equal(result.refresh, true); assert.match(result.message, /חלון או במכשיר אחר/);
  assert.equal(env.refreshed.length, 0);
});
test('RPC failures stay failures with safe Hebrew messages', async () => {
  for (const code of ['42501', '23505', '22023', '55000', 'P0002', 'PGRST202', 'P0001']) {
    const env = environment({ error: { code, message: 'internal_secret' } });
    const result = await env.actions.releaseEquipment(form());
    assert.equal(result.ok, false); assert.match(result.message, /[א-ת]/); assert.doesNotMatch(result.message, /internal_secret/);
    assert.equal(env.refreshed.length, 0);
  }
});
test('known business errors distinguish unavailable equipment and reused request', () => {
  assert.match(validation.rpcError({ code: '55000', message: 'פריט הציוד אינו פנוי להקצאה' }), /אינו פנוי/);
  assert.match(validation.rpcError({ code: '22023', message: 'מזהה הבקשה כבר שימש לתוכן אחר' }), /בקשה כבר שימשה/);
});
test('read returns new server clock; never loads availability for readonly or paused', async () => {
  for (const options of [{ editable: false }, { incident: { ...incident, lifecycle_status: 'paused' } }]) {
    const env = environment({ ...options, state: { ...data, server_now: '2026-09-16T13:00:00Z' } });
    const result = await env.actions.readEquipment(id);
    assert.equal(result.ok, true); assert.equal(result.data.server_now, '2026-09-16T13:00:00Z');
    assert.equal(env.calls.some((call) => call.name === 'get_available_equipment_for_incident'), false);
  }
});
test('direct page access denies before rendering equipment', async () => {
  const page = load('page.tsx', { './actions': { readEquipment: async () => ({ ok: false, denied: true, message: 'אסור' }) },
    './equipment-screen': { EquipmentScreen: () => null }, 'next/navigation': { notFound() { throw new Error('NOT_FOUND'); } } });
  await assert.rejects(page.default({ params: { incidentId: id } }), /NOT_FOUND/);
});
const component = load('equipment-screen.tsx', { './actions': {} });
test('SSR and first client render share clock placeholder, Hebrew/RTL markup', () => {
  const props = { incidentId: id, initial: data, initialError: null };
  const first = renderToStaticMarkup(React.createElement(component.EquipmentScreen, props));
  const second = renderToStaticMarkup(React.createElement(component.EquipmentScreen, props));
  assert.equal(first, second);
  for (const text of ['dir="rtl"', 'dir="ltr"', '--:--:--', 'ניהול ציוד', 'כשיר', 'כבוי', 'שער מערבי']) assert.ok(first.includes(text), text);
});
test('rendered clock shows negative time, warning text while paused, and full refuel state', () => {
  const overdue = renderToStaticMarkup(React.createElement(component.EquipmentClock, { row: { ...row, operation_state: 'paused', accumulated_active_seconds: 7955 }, serverTime: now }));
  assert.ok(overdue.includes('-00:12:35')); assert.ok(overdue.includes('חריגה'));
  const refueled = { ...row, operation_state: 'paused', version: 4 };
  const html = renderToStaticMarkup(React.createElement(component.EquipmentCard, { row: refueled, data, serverTime: now, disabled: false, run() {} }));
  assert.ok(html.includes('02:00:00')); assert.ok(html.includes('המשך הפעלה'));
  assert.ok(!html.includes('>הפעל<')); assert.ok(!html.includes('בוצע תדלוק'));
});
test('running card never offers release; readonly card has no mutation controls', () => {
  const html = renderToStaticMarkup(React.createElement(component.EquipmentCard, { row: { ...row, operation_state: 'running', running_since: data.server_now, first_started_at: data.server_now }, data, serverTime: now, disabled: false, run() {} }));
  assert.ok(!html.includes('שחרר ציוד')); assert.ok(html.includes('השהה'));
  const readonly = renderToStaticMarkup(React.createElement(component.EquipmentCard, { row, data: { ...data, canEdit: false }, serverTime: now, disabled: false, run() {} }));
  assert.ok(!readonly.includes('<button'));
});

// Minimal deterministic hook harness: execute real event handlers without a DOM
// or database. State survives re-renders and interval callbacks are controllable.
function harness(overrides = {}) {
  const slots = []; let cursor = 0; const effects = []; const callbacks = []; const confirms = []; const writes = [];
  let currentData = data; let resolveMutation;
  const hooks = { ...React, useContext: () => 0, useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(fn) { cursor++; return fn; }, useEffect(fn) { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(fn); } } };
  const mockedActions = { readEquipment: async () => ({ ok: true, data: currentData }) };
  for (const name of exportedActions) mockedActions[name] = async (payload) => {
    writes.push({ name, payload });
    if (overrides.defer) await new Promise((resolve) => { resolveMutation = resolve; });
    if (name === 'confirmEquipmentRefuel') currentData = { ...data, server_now: '2026-09-16T13:00:00Z', equipment: [{ ...row, operation_state: 'paused', version: 9 }] };
    if (name === 'releaseEquipment') currentData = { ...data, equipment: [] };
    return overrides.result ?? { ok: true, message: 'בוצע' };
  };
  const comp = load('equipment-screen.tsx', { react: hooks, './actions': mockedActions }, {
    performance: { now: () => 1000 }, crypto: { randomUUID: () => requestId },
    window: { confirm(message) { confirms.push(message); return true; }, setInterval(fn) { callbacks.push(fn); return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  });
  const render = () => { cursor = 0; return comp.EquipmentScreen({ incidentId: id, initial: data, initialError: null }); };
  return { render, effects, callbacks, confirms, writes, comp, slots, resolve: () => resolveMutation(),
    renderCard(props) { cursor = 0; return comp.EquipmentCard(props); } };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
async function mountedHarness(options) {
  const h = harness(options); h.render(); h.effects.forEach((fn) => fn());
  await new Promise((resolve) => setImmediate(resolve));
  return h;
}
test('real UI refuel handler asks once and uses refreshed paused/full server result', async () => {
  const h = await mountedHarness();
  let card = nodes(h.render(), (node) => node.type === h.comp.EquipmentCard)[0];
  await card.props.run('refuel', form(), { ...row, operation_state: 'running', first_started_at: data.server_now });
  assert.deepEqual(h.confirms, ['האם לאשר שבוצע תדלוק?']);
  assert.deepEqual(h.writes.map((call) => call.name), ['confirmEquipmentRefuel']);
  card = nodes(h.render(), (node) => node.type === h.comp.EquipmentCard)[0];
  assert.equal(card.props.row.operation_state, 'paused'); assert.equal(card.props.row.version, 9);
  assert.equal(card.props.serverTime, Date.parse('2026-09-16T13:00:00Z'));
  assert.equal(card.props.row.accumulated_active_seconds, 0);
});
test('real release handler never refuels; card removed only after server read', async () => {
  const h = await mountedHarness();
  const card = nodes(h.render(), (node) => node.type === h.comp.EquipmentCard)[0];
  assert.equal(await card.props.run('release', form(), row), true);
  assert.deepEqual(h.writes.map((call) => call.name), ['releaseEquipment']);
  assert.ok(h.confirms.every((text) => !text.includes('תדלוק')));
  assert.equal(nodes(h.render(), (node) => node.type === h.comp.EquipmentCard).length, 0);
});
test('real UI guard blocks double submission before the disabled render', async () => {
  const h = await mountedHarness({ defer: true });
  const run = nodes(h.render(), (node) => node.type === h.comp.EquipmentCard)[0].props.run;
  const first = run('start', form(), row);
  assert.equal(await run('start', form(), row), false);
  assert.equal(h.writes.length, 1); h.resolve(); await first;
});
test('failed release retains card and displays error instead of success', async () => {
  const h = await mountedHarness({ result: { ok: false, message: 'שגיאת הרשאה' } });
  const run = nodes(h.render(), (node) => node.type === h.comp.EquipmentCard)[0].props.run;
  assert.equal(await run('release', form(), row), false);
  const tree = h.render();
  assert.equal(nodes(tree, (node) => node.type === h.comp.EquipmentCard).length, 1);
  assert.ok(nodes(tree, (node) => node.props?.role === 'alert').some((node) => node.props.children === 'שגיאת הרשאה'));
});
test('stale UI operation refreshes the server view and keeps error status', async () => {
  const h = await mountedHarness({ result: { ok: false, refresh: true, message: 'מצב השתנה' } });
  const run = nodes(h.render(), (node) => node.type === h.comp.EquipmentCard)[0].props.run;
  assert.equal(await run('start', form(), row), false);
  assert.ok(nodes(h.render(), (node) => node.props?.role === 'alert').some((node) => node.props.children === 'מצב השתנה'));
});
test('timer re-render keeps same card key and open edit form', async () => {
  const h = await mountedHarness();
  const before = nodes(h.render(), (node) => node.type === h.comp.EquipmentCard)[0];
  h.callbacks[0]();
  const after = nodes(h.render(), (node) => node.type === h.comp.EquipmentCard)[0];
  assert.equal(before.props.row.assignment_id, after.props.row.assignment_id);
  const cardHarness = harness();
  const props = { row, data, serverTime: now, disabled: false, run: async () => false };
  let card = cardHarness.renderCard(props);
  nodes(card, (node) => node.type === 'button' && node.props.children === 'ערוך מיקום והערות')[0].props.onClick();
  card = cardHarness.renderCard({ ...props, serverTime: now + 1000 });
  assert.equal(nodes(card, (node) => node.type === 'form').length, 1);
});
test('Realtime editing preserves old draft and version until explicit reload', async () => {
  const h = harness(); const submissions = [];
  const props = { row, data, serverTime: now, disabled: false, run: async (...args) => { submissions.push(args); return true; } };
  let tree = h.renderCard(props);
  nodes(tree, (node) => node.type === 'button' && node.props.children === 'ערוך מיקום והערות')[0].props.onClick();
  const changed = { ...row, version: 4, location: 'מיקום ממכשיר אחר', team_id: null, ad_hoc_team_id: itemId };
  tree = h.renderCard({ ...props, row: changed });
  const location = nodes(tree, (node) => typeof node.type === 'function' && node.type.name === 'LocationFields')[0];
  assert.equal(location.props.row.location, row.location);
  assert.ok(nodes(tree, (node) => node.props?.role === 'status').length);
  await nodes(tree, (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {}, currentTarget: null });
  assert.equal(submissions.length, 0);
  nodes(tree, (node) => node.type === 'button' && node.props.children === 'טען ערכים חדשים')[0].props.onClick();
  tree = h.renderCard({ ...props, row: changed });
  assert.equal(nodes(tree, (node) => typeof node.type === 'function' && node.type.name === 'LocationFields')[0].props.row.location, changed.location);
});
test('released remote assignment retains its draft but disables writes and clock', () => {
  const h = harness(); const props = { row, data, serverTime: now, disabled: false, run: async () => false };
  let tree = h.renderCard(props);
  nodes(tree, (node) => node.type === 'button' && node.props.children === 'ערוך מיקום והערות')[0].props.onClick();
  tree = h.renderCard({ ...props, unavailable: true });
  assert.equal(nodes(tree, (node) => node.type === 'form').length, 1);
  assert.equal(nodes(tree, (node) => node.type === 'fieldset')[0].props.disabled, true);
  assert.equal(nodes(tree, (node) => node.type === h.comp.EquipmentClock).length, 0);
});

test('static safety: writes only RPC, no timer I/O, navigation and new read migration contracts', () => {
  const actionSource = fs.readFileSync(path.join(root, 'actions.ts'), 'utf8');
  assert.doesNotMatch(actionSource, /\.(insert|update|delete|upsert)\(/);
  const ui = fs.readFileSync(path.join(root, 'equipment-screen.tsx'), 'utf8');
  const timer = ui.match(/setInterval\(\(\) => \{([\s\S]*?)\}, 1000\)/)[1];
  assert.doesNotMatch(timer, /rpc|mutations|readEquipment|refresh/);
  assert.doesNotMatch(ui, /Date\.now\(|new Date\(\)|\.channel\(|window\.alert/);
  assert.match(ui, /key=\{row.assignment_id\} hidden=/);
  const migration = fs.readFileSync(path.resolve(root, '../../../../../supabase/migrations/20260916140000_equipment_incident_screen_reads.sql'), 'utf8');
  assert.match(migration, /assert_equipment_incident_editor/);
  assert.match(migration, /lifecycle_status='active'/);
  assert.match(migration, /i.is_active and t.is_active and i.serviceability='serviceable'/);
  assert.match(migration, /a.released_at is null/);
  assert.doesNotMatch(migration, /grant select|create policy|alter table/i);
  assert.equal((migration.match(/security definer/gi) ?? []).length, 2);
  assert.equal((migration.match(/set search_path = pg_catalog, public/g) ?? []).length, 2);
});
test('RPC named parameters match installed SQL and state extension is strictly additive', () => {
  const migrations = path.resolve(root, '../../../../../supabase/migrations');
  const stages = ['20260915130000_equipment_incident_assignments.sql', '20260915140000_equipment_clock_engine.sql',
    '20260916120000_equipment_alert_delivery.sql', '20260916130000_equipment_release_incident_lifecycle.sql'].map((file) => fs.readFileSync(path.join(migrations, file), 'utf8')).join('\n');
  for (const [action, rpc] of Object.entries(validation.actionRpcs)) {
    const matches = Array.from(stages.matchAll(new RegExp(`create (?:or replace )?function public\\.${rpc}\\(([^)]*)\\)`, 'gi')));
    assert.ok(matches.length > 0, rpc);
    const params = matches.at(-1)[1].split(',').map((part) => part.trim().split(/\s+/)[0]);
    assert.deepEqual(Object.keys(validation.actionPayload(action, form())).sort(), params.sort(), rpc);
  }
  const oldSql = fs.readFileSync(path.join(migrations, '20260915140000_equipment_clock_engine.sql'), 'utf8').replace(/\r\n/g, '\n');
  const newSql = fs.readFileSync(path.join(migrations, '20260916140000_equipment_incident_screen_reads.sql'), 'utf8');
  const getBody = (sql) => sql.match(/function public.get_incident_equipment_state\(p_incident_id uuid\)([\s\S]*?)\$\$;/)[1];
  assert.equal(getBody(newSql).replace("'serial_number',i.serial_number,", ''), getBody(oldSql));
  assert.doesNotMatch(newSql, /TODO|FIXME|placeholder/i);
  assert.match(newSql, /begin;[\s\S]*commit;\s*$/);
  const shell = fs.readFileSync(path.resolve(root, '../incident-command-shell.tsx'), 'utf8');
  assert.match(shell, /canReadEquipment && <Link/);
});
