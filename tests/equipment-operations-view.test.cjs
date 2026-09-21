const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../app/(protected)/incidents/[incidentId]/equipment');
function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(name) {
    const file = path.join(root, name);
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, console, FormData, Date, Map, Set, Error,
      require(id) {
        if (Object.hasOwn(mocks, id)) return mocks[id];
        if (id.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
        if (id === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
        if (id.startsWith('./')) return load(`${id.slice(2)}.${fs.existsSync(path.join(root, id + '.tsx')) ? 'tsx' : 'ts'}`);
        return require(id);
      }, ...globals }, { filename: file });
    cache.set(file, module.exports); return module.exports;
  }
  return load;
}
const load = loader();
const model = load('equipment-model.ts');
const view = load('equipment-presentation.ts');
const indicators = load('equipment-indicators.tsx');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-09-17T12:00:00Z');
const row = { assignment_id: id, equipment_item_id: id, cycle_id: id, version: 1, operation_state: 'off',
  accumulated_active_seconds: 0, running_since: null, first_started_at: null, full_runtime_seconds_snapshot: 600,
  warning_before_seconds_snapshot: 120, asset_identifier_snapshot: 'גנרטור 7', serial_number: 'SN-7',
  equipment_type_id_snapshot: id, equipment_type_name_snapshot: 'גנרטור', instructions_snapshot: null,
  team_id: id, ad_hoc_team_id: null, team_name: 'צוות בדיקה', team_number: 93, location: 'שער', notes: '',
  equipment_item_is_active: true, equipment_type_is_active: true, serviceability: 'serviceable' };
const data = { server_now: new Date(now).toISOString(), equipment: [row], incident: { name: 'בדיקה', lifecycle_status: 'active', is_closed: false, archived_at: null }, canEdit: true, teams: [], available: [], availabilityError: null };
const active = (elapsed, props = {}) => ({ ...row, operation_state: 'paused', first_started_at: data.server_now, accumulated_active_seconds: elapsed, ...props });
const html = (Comp, props) => renderToStaticMarkup(React.createElement(Comp, props));
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function harness() {
  const slots = [], effects = []; let cursor = 0, revision = 0, current = data; const stored = new Map(), calls = [];
  const hooks = { ...React, useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
    return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useCallback(fn) { cursor++; return fn; }, useEffect(fn, deps) { const i = cursor++;
      if (!slots[i] || deps.some((dep, j) => dep !== slots[i][j])) { slots[i] = deps; effects.push(fn); } } };
  const localLoad = loader({ react: hooks, './equipment-refresh-context': { useEquipmentRevision: () => revision },
    './actions': { readEquipment: async () => ({ ok: true, data: current }) } }, {
    performance: { now: () => 100 }, crypto: { randomUUID: () => id },
    window: { localStorage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) },
      setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {}, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: true }) },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById: (id) => ({
      focus: () => calls.push(['focus', id]), scrollIntoView: (options) => calls.push(['scroll', id, options]) }) }
  });
  return { load: localLoad, stored, calls, render(Comp, props) { cursor = 0; return Comp(props); },
    async flush() { const pending = effects.splice(0); pending.forEach((effect) => effect()); await new Promise(setImmediate); },
    realtime(next) { current = next; revision++; } };
}

test('regular/ad-hoc/missing teams remain separate and none disappears', () => {
  const groups = model.groupEquipment([row, { ...row, assignment_id: other, team_id: null, ad_hoc_team_id: other }, { ...row, assignment_id: 'none', team_name: null }]);
  assert.deepEqual(Array.from(groups, (g) => g.key), [`regular:${id}`, `ad_hoc:${other}`, 'none']);
  assert.equal(groups[2].label, 'ללא צוות');
});
test('actual team numbers classify headquarters, population, professionals and ad-hoc dynamically', () => {
  assert.equal(view.teamCategory(93), 'חפ״ק'); assert.equal(view.teamCategory(9), 'אוכלוסייה');
  assert.equal(view.teamCategory(91), 'צוותים מקצועיים'); assert.equal(view.teamCategory(92), 'צוותים מקצועיים');
  assert.equal(view.teamCategory(42), 'צוותים נוספים'); assert.equal(view.teamCategory(null, true), 'צוותי אד־הוק');
  const teams = [{ key: `regular:${id}`, label: 'שם מותאם', category: view.teamCategory(93) }];
  const groups = view.teamOptionsByCategory(teams); assert.equal(groups.length, 1); assert.equal(groups[0].options[0], teams[0]);
});
test('team selector renders only supplied real destinations and optgroups', () => {
  const Comp = loader({ './actions': {} })('equipment-screen.tsx').TeamSelect;
  const result = html(Comp, { teams: [93, 9].map((n) => ({ key: `regular:${n}`, label: `יעד ${n}`, category: view.teamCategory(n) })) });
  assert.match(result, /optgroup label="חפ״ק"/); assert.match(result, /optgroup label="אוכלוסייה"/); assert.doesNotMatch(result, /צוותים מקצועיים/);
});
for (const [name, fixture, tone, label] of [
  ['above threshold', active(100), 'normal', 'תקין'], ['warning', active(500), 'warning', 'נדרש תדלוק'],
  ['zero', active(600), 'overdue', 'זמן עבודה הסתיים'], ['negative', active(650), 'overdue', 'זמן עבודה הסתיים'],
  ['unstarted off', row, 'neutral', 'כבוי'], ['paused warning', active(530), 'warning', 'נדרש תדלוק'],
  ['refueled unstarted paused', { ...row, operation_state: 'paused' }, 'normal', 'תקין']
]) test(`fuel gauge ${name}`, () => {
  const state = view.controlState(fixture, now); assert.equal(state.tone, tone); assert.equal(state.label, label);
  const result = html(indicators.FuelGauge, { row: fixture, serverTime: now }); assert.match(result, /role="img"/); assert.match(result, new RegExp(label));
});
test('fuel clamps both ends and exact negative clock is retained', () => {
  assert.equal(view.controlState(active(900), now).fuel, 0); assert.equal(view.controlState(active(-100), now).fuel, 100);
  assert.match(html(indicators.EquipmentTime, { row: active(650), serverTime: now }), /-00:00:50/);
});
test('equipment icon is local decorative 22px SVG without emoji', () => {
  const result = html(indicators.EquipmentIcon, {}); assert.match(result, /width="22"/); assert.match(result, /aria-hidden="true"/); assert.doesNotMatch(result, /🧰/);
});
test('critical before warning, serviceability before running, then paused/off', () => {
  const fixtures = [row, active(50), active(30, { operation_state: 'running' }), { ...row, serviceability: 'restricted' }, active(500), active(650)]
    .map((r, i) => ({ ...r, assignment_id: String(i) }));
  assert.deepEqual(Array.from(view.sortEquipment(fixtures, now, 'exceptions'), (r) => r.assignment_id), ['5', '4', '3', '2', '1', '0']);
});
test('group containing an exception appears first', () => {
  const ordered = view.createEquipmentOrdering()([row, active(650, { assignment_id: other, team_id: other, team_name: 'צוות חריגה' })], now, 'exceptions', 'a');
  assert.equal(ordered[0].key, `regular:${other}`);
});
test('group ordering prioritizes alarms then running groups before paused groups', () => {
  const fixtures = [active(0, { assignment_id: 'quality', team_id: 'quality', serviceability: 'restricted' }),
    active(0, { assignment_id: 'running', team_id: 'running', operation_state: 'running' }),
    active(650, { assignment_id: 'critical', team_id: 'critical' })];
  assert.deepEqual(Array.from(view.createEquipmentOrdering()(fixtures, now, 'exceptions', 'a'), (g) => g.key),
    ['regular:critical', 'regular:running', 'regular:quality']);
});
test('an automatically opened group remains open when Realtime grows the list', async () => {
  const h = harness(); const { EquipmentScreen } = h.load('equipment-screen.tsx');
  const props = { incidentId: id, initial: data, initialError: null };
  h.render(EquipmentScreen, props); await h.flush(); h.render(EquipmentScreen, props);
  h.realtime({ ...data, equipment: Array.from({ length: 13 }, (_, i) => ({ ...row, assignment_id: String(i) })) });
  h.render(EquipmentScreen, props); await h.flush(); const tree = h.render(EquipmentScreen, props);
  assert.equal(nodes(tree, (n) => n.type === 'button' && n.props['aria-expanded'] === true).length, 1);
});
test('a text filter hiding exceptions never claims all equipment is healthy', async () => {
  const h = harness(); const { EquipmentScreen } = h.load('equipment-screen.tsx');
  const props = { incidentId: id, initial: data, initialError: null };
  h.realtime({ ...data, equipment: [active(650)] }); h.render(EquipmentScreen, props); await h.flush();
  let tree = h.render(EquipmentScreen, props);
  nodes(tree, (n) => n.type === 'button' && n.props.children === 'הצג חריגים בלבד')[0].props.onClick();
  nodes(tree, (n) => n.type === 'input' && n.props.type === 'search')[0].props.onChange({ target: { value: 'אין התאמה' } });
  tree = h.render(EquipmentScreen, props);
  assert.equal(nodes(tree, (n) => n.props?.children === 'כל הציוד במצב תקין').length, 0);
  assert.equal(nodes(tree, (n) => n.props?.children === 'אין חריגים התואמים לסינון שנבחר.').length, 1);
});
test('time crossing inside a severity category does not reorder until server refresh', () => {
  const fixtures = [active(100, { assignment_id: id, operation_state: 'running', running_since: data.server_now }), active(110, { assignment_id: other })];
  const order = view.createEquipmentOrdering();
  assert.equal(order(fixtures, now, 'remaining', 'a')[0].rows[0].assignment_id, other);
  assert.equal(order(fixtures, now + 20000, 'remaining', 'a')[0].rows[0].assignment_id, other);
  assert.equal(order(fixtures, now + 20000, 'remaining', 'b')[0].rows[0].assignment_id, id);
});
test('category crossing reorders immediately and war room is globally severity sorted', () => {
  const fixtures = [active(490, { assignment_id: id, operation_state: 'running', running_since: data.server_now }), active(500, { assignment_id: other, team_id: other })];
  const order = view.createEquipmentRowOrdering();
  assert.equal(order(fixtures, now, 'a')[0].assignment_id, other);
  assert.equal(order(fixtures, now + 111000, 'a')[0].assignment_id, id);
});
test('exception filter includes warning, overdue, catalog and invalid clock only', () => {
  for (const r of [active(500), active(700), { ...row, serviceability: 'restricted' }, { ...row, full_runtime_seconds_snapshot: NaN }]) assert.equal(view.matchesFocus(r, now, 'exceptions'), true);
  assert.equal(view.matchesFocus(row, now, 'exceptions'), false);
});
test('primary action is start/pause/resume and permission contract still forbids running release', () => {
  assert.equal(view.primaryAction(row), 'start'); assert.equal(view.primaryAction(active(1)), 'resume');
  const running = active(1, { operation_state: 'running' }); assert.equal(view.primaryAction(running), 'pause');
  assert.equal(model.allowedActions(running, data.incident, true).includes('release'), false);
});
test('view preference persists and blocked local storage falls back safely', () => {
  const store = new Map(); const storage = { getItem: (k) => store.get(k), setItem: (k, v) => store.set(k, v) };
  assert.equal(view.readViewMode(storage), 'compact'); view.saveViewMode(storage, 'detailed'); assert.equal(view.readViewMode(storage), 'detailed');
  assert.equal(view.readViewMode({ getItem() { throw Error(); } }), 'compact'); assert.doesNotThrow(() => view.saveViewMode({ setItem() { throw Error(); } }, 'compact'));
});
test('compact expansion and editing survive updated props and mode switch', async () => {
  const h = harness(); const { EquipmentCard } = h.load('equipment-screen.tsx');
  let props = { row, data, serverTime: now, disabled: false, run: async () => false, mode: 'compact' };
  let tree = h.render(EquipmentCard, props);
  assert.equal(nodes(tree, (n) => n.props?.id === `details-${id}`)[0].props.hidden, true);
  nodes(tree, (n) => n.type === 'button' && n.props.children === 'פרטים')[0].props.onClick();
  tree = h.render(EquipmentCard, { ...props, row: { ...row, version: 2 } });
  assert.equal(nodes(tree, (n) => n.props?.id === `details-${id}`)[0].props.hidden, false);
  nodes(tree, (n) => n.type === 'button' && n.props.children === 'ערוך מיקום והערות')[0].props.onClick();
  tree = h.render(EquipmentCard, { ...props, mode: 'detailed' });
  assert.equal(nodes(tree, (n) => n.type === 'form').length, 1);
});
test('group collapse, view and filters persist across scoped Realtime', async () => {
  const h = harness(); const { EquipmentScreen } = h.load('equipment-screen.tsx');
  const props = { incidentId: id, initial: data, initialError: null };
  h.render(EquipmentScreen, props); await h.flush(); let tree = h.render(EquipmentScreen, props);
  nodes(tree, (n) => n.type === 'button' && n.props['aria-expanded'] === true)[0].props.onClick();
  nodes(tree, (n) => n.type === 'button' && n.props.children === 'תצוגה מפורטת')[0].props.onClick();
  h.realtime({ ...data, server_now: new Date(now + 1000).toISOString() }); h.render(EquipmentScreen, props); await h.flush(); tree = h.render(EquipmentScreen, props);
  assert.equal(nodes(tree, (n) => n.type === 'button' && n.props['aria-expanded'] === false).length, 1);
  assert.equal(nodes(tree, (n) => n.type === 'button' && n.props.children === 'תצוגה מפורטת')[0].props['aria-pressed'], true);
});
test('exceptions-only all-good message leaves a return-to-all control', async () => {
  const h = harness(); const { EquipmentScreen } = h.load('equipment-screen.tsx'); const props = { incidentId: id, initial: data, initialError: null };
  h.render(EquipmentScreen, props); await h.flush(); let tree = h.render(EquipmentScreen, props);
  nodes(tree, (n) => n.type === 'button' && n.props.children === 'הצג חריגים בלבד')[0].props.onClick();
  tree = h.render(EquipmentScreen, props);
  assert.ok(nodes(tree, (n) => n.props?.children === 'כל הציוד במצב תקין').length);
  assert.ok(nodes(tree, (n) => n.type === 'button' && n.props.children === 'הצג את כל הציוד').length);
});
test('deep link opens group, marks target, scrolls with reduced motion and handles released target', async () => {
  for (const target of [id, other]) {
    const h = harness(); const { EquipmentScreen } = h.load('equipment-screen.tsx'); const props = { incidentId: id, initial: data, initialError: null, targetAssignment: target };
    h.render(EquipmentScreen, props); await h.flush(); h.render(EquipmentScreen, props); await h.flush();
    const tree = h.render(EquipmentScreen, props); await h.flush();
    if (target === id) { assert.ok(nodes(tree, (n) => n.props?.focused === true).length); assert.equal(h.calls.find((c) => c[0] === 'scroll')[2].behavior, 'auto'); }
    else assert.ok(nodes(tree, (n) => typeof n.props?.children === 'string' && n.props.children.includes('ייתכן שכבר שוחרר')).length);
  }
});
test('safe deep link uses assignment parameter without write authority', () => {
  assert.equal(view.equipmentHref(id, other), `/incidents/${id}/equipment?assignment=${other}`);
  const page = fs.readFileSync(path.join(root, 'page.tsx'), 'utf8'); assert.match(page, /uuidPattern.test\(searchParams.assignment\)/);
});
test('war room defaults to equipment for alerts and events without allocations', () => {
  assert.equal(view.defaultEquipmentTab([active(600)]), 'equipment'); assert.equal(view.defaultEquipmentTab([]), 'events');
});
test('war room keeps recent events and chosen tab through Realtime without a second subscription', async () => {
  const h = harness(); const { WarRoomEquipment } = h.load('war-room-equipment.tsx'); const props = { incidentId: id, initial: data, children: 'אירוע אחרון נשמר' };
  let tree = h.render(WarRoomEquipment, props); await h.flush();
  nodes(tree, (n) => n.props?.id === 'war-events-tab')[0].props.onClick();
  h.realtime({ ...data, equipment: [active(650)] }); h.render(WarRoomEquipment, props); await h.flush(); tree = h.render(WarRoomEquipment, props);
  assert.equal(nodes(tree, (n) => n.props?.id === 'war-events-panel')[0].props.hidden, false);
  assert.equal(nodes(tree, (n) => n.props?.id === 'war-events-panel')[0].props.children, 'אירוע אחרון נשמר');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'war-room-equipment.tsx'), 'utf8'), /\.channel\(|router.refresh/);
});
test('readonly compact view exposes details but no mutations', () => {
  const Comp = loader({ './actions': {} })('equipment-screen.tsx').EquipmentCard;
  const result = html(Comp, { row, data: { ...data, canEdit: false }, serverTime: now, disabled: false, run() {}, mode: 'compact' });
  assert.match(result, /פרטים/); assert.doesNotMatch(result, /שחרר ציוד|בוצע תדלוק|>הפעל</);
});
test('responsive and reduced-motion styles, no second-based writes or full refresh', () => {
  const css = fs.readFileSync(path.join(root, 'war-room-equipment.module.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /animation: none/); assert.match(css, /min-height: 44px/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  const equipment = fs.readFileSync(path.join(root, 'equipment.module.css'), 'utf8'); assert.match(equipment, /prefers-reduced-motion/);
  assert.match(equipment, /\.expandedContent\[hidden\]/);
});
