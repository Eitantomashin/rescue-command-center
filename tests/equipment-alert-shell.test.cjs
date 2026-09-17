// Pure local fixtures/mocks. No Supabase or production data access.
// node --test --experimental-test-isolation=none tests/equipment-alert-shell.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../app/(protected)/incidents/[incidentId]/equipment');
function load(name, mocks = {}, globals = {}, cache = new Map()) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(root, name);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX
  } }).outputText;
  const module = { exports: {} }; cache.set(name, module.exports);
  vm.runInNewContext(source, { module, exports: module.exports, FormData, Error, Date, Map, Set, console,
    setTimeout, clearTimeout, require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (id.startsWith('./')) { const local = id.slice(2); return load(local + (fs.existsSync(path.join(root, local + '.ts')) ? '.ts' : '.tsx'), mocks, globals, cache); }
      return require(id);
    }, ...globals }, { filename: file });
  return module.exports;
}
const model = load('alert-model.ts');
const { EquipmentAlertController } = load('alert-controller.ts');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const token = '33333333-3333-4333-8333-333333333333';
const base = Date.parse('2026-09-17T10:00:00Z');
const iso = (time) => new Date(time).toISOString();
const alert = { alert_id: id, incident_id: id, assignment_id: id, cycle_id: id, version: 2, operation_state: 'paused',
  accumulated_active_seconds: 5500, full_runtime_seconds_snapshot: 7200, warning_before_seconds_snapshot: 1800,
  running_since: null, first_started_at: iso(base - 6000000), server_now: iso(base), severity: 'warning', detected_at: iso(base),
  asset_identifier_snapshot: 'גנרטור 7', equipment_type_name_snapshot: 'גנרטור', serial_number: 'SN-7',
  team_id: id, ad_hoc_team_id: null, team_name: 'אלון', location: 'שער', notes: null };
const row = { alert, token, expiresAt: base + 30000, acknowledged: false, claimedSeverity: 'warning' };
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Implements the *documented stage 5* lease/due/token rules as a test double.
// The SQL regression separately exercises the real RPCs on a disposable DB.
function backend() {
  const state = { now: base, alerts: [{ ...alert }], deliveries: new Map(), calls: [], delaySync: null };
  function api(user = 'user1') {
    return {
      async sync() {
        state.calls.push(['sync', user]); if (state.delaySync) await state.delaySync;
        return { ok: true, data: { server_now: iso(state.now), alerts: state.alerts.map((a) => ({ ...a, server_now: iso(state.now) })),
          presentations: [...state.deliveries].filter(([key]) => key.startsWith(user + ':')).map(([, d]) => ({ ...d })) } };
      },
      async claim(presentationToken) {
        state.calls.push(['claim', user, presentationToken]); const result = [];
        for (const current of state.alerts) {
          const key = `${user}:${current.alert_id}`;
          let delivery = state.deliveries.get(key);
          if (delivery && Date.parse(delivery.lease_until) > state.now) continue;
          if (delivery && delivery.presentation_token === presentationToken) continue;
          const critical = current.severity === 'critical' && delivery?.last_presented_severity !== 'critical';
          if (delivery && !critical && (Date.parse(delivery.next_due_at) > state.now || Date.parse(delivery.snoozed_until) > state.now)) continue;
          delivery = { ...delivery, alert_id: current.alert_id, presentation_token: presentationToken, lease_until: iso(state.now + 30000),
            presentation_acknowledged: false, claimed_severity: current.severity, dismissed_at: null };
          state.deliveries.set(key, delivery);
          result.push({ ...current, server_now: iso(state.now), presentation_token: presentationToken, lease_until: delivery.lease_until, claimed_severity: current.severity });
        }
        return { ok: true, data: { server_now: iso(state.now), alerts: result } };
      },
      async ack(alertId, presentationToken) { return present('ack', user, alertId, presentationToken); },
      async dismiss(alertId, presentationToken) { return present('dismiss', user, alertId, presentationToken); }
    };
  }
  function present(action, user, alertId, presentationToken) {
    state.calls.push([action, user, presentationToken]); const delivery = state.deliveries.get(`${user}:${alertId}`);
    if (!state.alerts.some((a) => a.alert_id === alertId) || !delivery || delivery.presentation_token !== presentationToken
      || (!delivery.presentation_acknowledged && Date.parse(delivery.lease_until) <= state.now)) return { ok: false, stopped: true, message: 'הצגה לא תקפה' };
    if ((action === 'ack' && delivery.presentation_acknowledged) || (action === 'dismiss' && delivery.dismissed_at)) return { ok: true, data: { ...delivery } };
    if (!delivery.presentation_acknowledged) delivery.last_presented_severity = delivery.claimed_severity;
    delivery.presentation_acknowledged = true; delivery.lease_until = null; delivery.next_due_at = iso(state.now + 300000);
    if (action === 'dismiss') { delivery.dismissed_at = iso(state.now); delivery.snoozed_until = iso(state.now + 300000); }
    return { ok: true, data: { ...delivery } };
  }
  return { state, api };
}
let tokenSequence = 0;
function engine(db, user) {
  let view = null; const sounds = [];
  const ctrl = new EquipmentAlertController(id, db.api(user), (value) => { view = value; }, (value) => sounds.push(value),
    () => db.state.now - base, () => `00000000-0000-4000-8000-${String(++tokenSequence).padStart(12, '0')}`);
  return { ctrl, sounds, get view() { return view; } };
}
test('moderate polling is 25 seconds, never a second', () => assert.equal(model.ALERT_POLL_MS, 25000));
test('only a claim owned by this event enters the visible queue', async () => {
  const db = backend(); db.state.alerts.push({ ...alert, alert_id: other, incident_id: other });
  const e = engine(db); await e.ctrl.requestSync(); assert.equal(e.view.queue.length, 1); e.ctrl.stop();
});
test('sync calls coalesce and never run concurrently', async () => {
  const db = backend(); let release; db.state.delaySync = new Promise((resolve) => { release = resolve; });
  const e = engine(db); const first = e.ctrl.requestSync(); await flush();
  for (let n = 0; n < 10; n++) e.ctrl.requestSync();
  assert.equal(db.state.calls.filter((call) => call[0] === 'sync').length, 1);
  release(); await first;
  assert.equal(db.state.calls.filter((call) => call[0] === 'sync').length, 2); e.ctrl.stop();
});
test('ack occurs after presented, plays once, and repeated sync does not move deadline', async () => {
  const db = backend(); const e = engine(db); await e.ctrl.requestSync();
  assert.equal(db.state.calls.some((call) => call[0] === 'ack'), false);
  const key = model.presentationKey(e.view.queue[0]); await e.ctrl.presented(key); await e.ctrl.presented(key);
  const deadline = db.state.deliveries.get('user1:' + id).next_due_at;
  db.state.now += 25000; await e.ctrl.requestSync();
  assert.deepEqual(e.sounds, ['warning']); assert.equal(db.state.deliveries.get('user1:' + id).next_due_at, deadline); e.ctrl.stop();
});
test('dismiss is personal five-minute scheduling, not resolution or refuel', async () => {
  const db = backend(); const e = engine(db); await e.ctrl.requestSync();
  await e.ctrl.dismiss(model.presentationKey(e.view.queue[0])); await e.ctrl.requestSync();
  assert.equal(e.view.queue.length, 0); assert.equal(db.state.alerts.length, 1);
  assert.equal(Date.parse(db.state.deliveries.get('user1:' + id).snoozed_until), base + 300000);
  db.state.now += 300001; await e.ctrl.requestSync(); assert.equal(e.view.queue.length, 1); e.ctrl.stop();
});
test('critical bypasses warning snooze through a new database claim', async () => {
  const db = backend(); const e = engine(db); await e.ctrl.requestSync(); await e.ctrl.dismiss(model.presentationKey(e.view.queue[0]));
  await e.ctrl.requestSync(); db.state.now += 1000; db.state.alerts[0].severity = 'critical'; db.state.alerts[0].accumulated_active_seconds = 7200;
  await e.ctrl.requestSync(); assert.equal(e.view.queue[0].alert.severity, 'critical'); e.ctrl.stop();
});
test('active lease cannot be stolen by another tab even for critical', async () => {
  const db = backend(); const one = engine(db); const two = engine(db);
  await one.ctrl.requestSync(); db.state.alerts[0].severity = 'critical'; await two.ctrl.requestSync();
  assert.equal(one.view.queue.length, 1); assert.equal(two.view.queue.length, 0); one.ctrl.stop(); two.ctrl.stop();
});
test('different users claim independently and cannot snooze one another', async () => {
  const db = backend(); const one = engine(db, 'one'); const two = engine(db, 'two');
  await one.ctrl.requestSync(); await two.ctrl.requestSync();
  await one.ctrl.dismiss(model.presentationKey(one.view.queue[0])); await two.ctrl.requestSync();
  assert.equal(two.view.queue.length, 1); assert.equal(db.state.deliveries.get('two:' + id).dismissed_at, null); one.ctrl.stop(); two.ctrl.stop();
});
test('expired old token cannot ack or dismiss a new claim', async () => {
  const db = backend(); const one = engine(db); await one.ctrl.requestSync(); const old = one.view.queue[0].token;
  db.state.now += 31000; const two = engine(db); await two.ctrl.requestSync();
  assert.equal((await db.api().ack(id, old)).ok, false); assert.equal((await db.api().dismiss(id, old)).ok, false);
  await one.ctrl.requestSync(); assert.equal(one.view.queue.length, 0); one.ctrl.stop(); two.ctrl.stop();
});
test('multiple alerts sort critical first then discovery and do not duplicate', async () => {
  const db = backend(); db.state.alerts.push({ ...alert, alert_id: other, severity: 'critical', accumulated_active_seconds: 7500 });
  const e = engine(db); await e.ctrl.requestSync(); await e.ctrl.requestSync();
  assert.equal(e.view.queue.length, 2); assert.equal(e.view.queue[0].alert.alert_id, other);
  await e.ctrl.dismiss(model.presentationKey(e.view.queue[0])); await e.ctrl.requestSync();
  assert.equal(e.view.queue[0].alert.alert_id, id); e.ctrl.stop();
});
test('paused alert remains active and receives current location/team', async () => {
  const db = backend(); const e = engine(db); await e.ctrl.requestSync();
  db.state.alerts[0] = { ...db.state.alerts[0], location: 'מזרח', team_id: null, ad_hoc_team_id: other, team_name: 'אור' };
  await e.ctrl.requestSync(); assert.equal(e.view.queue.length, 1); assert.equal(e.view.queue[0].alert.location, 'מזרח'); e.ctrl.stop();
});
for (const reason of ['refuel', 'release', 'closure']) test(`${reason} removes a resolved cycle from every local presentation`, async () => {
  const db = backend(); const e = engine(db); await e.ctrl.requestSync(); db.state.alerts = []; await e.ctrl.requestSync();
  assert.equal(e.view.queue.length, 0); e.ctrl.stop();
});
test('tick only renders except one expiry/threshold transition; no second-based writes', async () => {
  const db = backend(); const e = engine(db); await e.ctrl.requestSync(); const count = db.state.calls.length;
  for (let n = 0; n < 20; n++) { db.state.now += 1000; e.ctrl.tick(); }
  assert.equal(db.state.calls.length, count); e.ctrl.stop();
});
test('suspended tab displays nothing and synchronizes on resume', async () => {
  const db = backend(); const e = engine(db); await e.ctrl.requestSync(); e.ctrl.suspend(); assert.equal(e.view.queue.length, 0);
  const count = db.state.calls.length; await e.ctrl.requestSync(); assert.equal(db.state.calls.length, count);
  await e.ctrl.resume(); assert.equal(e.view.queue.length, 1); e.ctrl.stop();
});
test('disconnect hides stale presentation until server is synchronized', async () => {
  const db = backend(); const e = engine(db); await e.ctrl.requestSync(); e.ctrl.disconnect(); assert.equal(e.view.queue.length, 0);
  await e.ctrl.resume(); assert.equal(e.view.queue.length, 1); e.ctrl.stop();
});
test('stop ignores a late response and prevents more claims', async () => {
  const db = backend(); let release; db.state.delaySync = new Promise((r) => { release = r; }); const e = engine(db);
  const pending = e.ctrl.requestSync(); await flush(); e.ctrl.stop(); release(); await pending;
  assert.equal(db.state.calls.some((call) => call[0] === 'claim'), false);
});
test('blocked or throwing sound cannot suppress acknowledged visual delivery', async () => {
  const db = backend(); let view;
  const e = new EquipmentAlertController(id, db.api(), (v) => { view = v; }, () => { throw new Error('autoplay'); }, () => 0, () => token);
  await e.requestSync(); await e.presented(model.presentationKey(view.queue[0]));
  assert.equal(view.queue.length, 1); assert.equal(view.ready, true); e.stop();
});

function realtimeHarness({ authorized = true, user = { id }, failures = 0 } = {}) {
  let receive, status; const calls = []; const timers = new Map(); let nextTimer = 0;
  const channel = { on(name, filter, handler) { calls.push(['filter', filter]); receive = handler; return channel; },
    subscribe(handler) { status = handler; calls.push(['subscribe']); return channel; } };
  const client = { auth: { getUser: async () => ({ data: { user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { calls.push(['auth-cleanup']); } } } }) },
    rpc: async () => ({ data: authorized, error: failures-- > 0 ? { message: 'offline' } : null }), channel(name) { calls.push(['channel', name]); return channel; },
    removeChannel() { calls.push(['remove']); } };
  const realtime = load('equipment-realtime.ts', { '@/lib/supabase/client': { createClient: () => client } }, {
    setTimeout(fn) { const key = ++nextTimer; timers.set(key, fn); return key; }, clearTimeout(key) { timers.delete(key); }
  });
  return { realtime, calls, signal(payload) { receive({ new: payload }); }, status: (value) => status(value),
    flushTimers() { for (const [key, fn] of timers) { timers.delete(key); fn(); } }, timers };
}
test('one subscription per incident/user, scoped filter, and ref-counted cleanup', async () => {
  const h = realtimeHarness(); const first = [], second = [];
  const off1 = h.realtime.watchEquipment(id, id, (e) => first.push(e)); const off2 = h.realtime.watchEquipment(id, id, (e) => second.push(e));
  await flush(); assert.equal(h.calls.filter((c) => c[0] === 'channel').length, 1);
  assert.equal(h.calls.find((c) => c[0] === 'filter')[1].filter, `incident_id=eq.${id}`);
  h.status('SUBSCRIBED'); assert.equal(first[0].kind, 'connected'); assert.equal(second[0].kind, 'connected');
  off1(); assert.equal(h.calls.some((c) => c[0] === 'remove'), false); off2(); assert.equal(h.calls.filter((c) => c[0] === 'remove').length, 1);
});
test('Realtime ignores other incidents and batches duplicate row events', async () => {
  const h = realtimeHarness(); const received = []; const stop = h.realtime.watchEquipment(id, id, (e) => received.push(e)); await flush();
  h.signal({ incident_id: other, event_type: 'cycle' }); h.flushTimers(); assert.equal(received.length, 0);
  h.signal({ incident_id: id, event_type: 'cycle' }); h.signal({ incident_id: id, event_type: 'assignment' }); h.flushTimers();
  assert.equal(received.length, 1); assert.equal(received[0].kind, 'change'); stop();
});
test('reconnect notifies a full-state refresh and cleanup cancels pending work', async () => {
  const h = realtimeHarness(); const received = []; const stop = h.realtime.watchEquipment(id, id, (e) => received.push(e)); await flush();
  h.status('SUBSCRIBED'); h.status('CHANNEL_ERROR'); h.status('SUBSCRIBED');
  assert.deepEqual(received.map((e) => e.kind), ['connected', 'disconnected', 'connected']);
  h.signal({ incident_id: id, event_type: 'catalog' }); stop(); assert.equal(h.timers.size, 0);
});
test('anonymous or unauthorized user never creates a Realtime channel', async () => {
  for (const options of [{ user: null }, { authorized: false }, { user: { id: other } }]) {
    const h = realtimeHarness(options); const stop = h.realtime.watchEquipment(id, id, () => {}); await flush();
    assert.equal(h.calls.some((c) => c[0] === 'channel'), false); stop();
  }
});

test('initial transient failure retries once online and pending retry is cleaned up', async () => {
  const h = realtimeHarness({ failures: 1 });
  const stop = h.realtime.watchEquipment(id, id, () => {});
  await flush(); assert.equal(h.calls.some((c) => c[0] === 'channel'), false);
  assert.equal(h.timers.size, 1);
  h.flushTimers(); await flush();
  assert.equal(h.calls.filter((c) => c[0] === 'channel').length, 1);
  stop(); assert.equal(h.timers.size, 0);
  const offline = realtimeHarness({ failures: 2 });
  const cleanup = offline.realtime.watchEquipment(id, id, () => {});
  await flush(); assert.equal(offline.timers.size, 1);
  cleanup(); assert.equal(offline.timers.size, 0);
});

function serverActions(options = {}) {
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: options.noUser ? null : { id } } }) },
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      if (name === 'current_user_role') return { data: options.role ?? 'editor', error: null };
      if (name.startsWith('can_')) return { data: options.allowed ?? true, error: null };
      return { data: {}, error: options.error ?? null };
    }, from() { throw new Error('No direct writes'); } };
  return { actions: load('alert-actions.ts', { '@/lib/supabase/server': { createClient: () => client } }), calls };
}
test('server actions call exact sync/claim/ack/dismiss signatures', async () => {
  const h = serverActions();
  assert.equal((await h.actions.syncEquipmentAlerts(id)).ok, true);
  await h.actions.claimEquipmentAlerts(id, token); await h.actions.ackEquipmentAlert(id, other, token); await h.actions.dismissEquipmentAlert(id, other, token);
  const calls = h.calls.filter((c) => !c.name.startsWith('can_') && c.name !== 'current_user_role');
  assert.deepEqual(calls.map((c) => c.name), ['sync_equipment_alerts', 'claim_equipment_alerts', 'ack_equipment_alert_presented', 'dismiss_equipment_alert']);
  assert.deepEqual(Object.keys(calls[2].payload).sort(), ['p_alert_id', 'p_incident_id', 'p_presentation_token']);
});
test('viewer, inactive/unreadable, anonymous cannot claim or dismiss', async () => {
  for (const options of [{ role: 'viewer' }, { allowed: false }, { noUser: true }]) {
    const h = serverActions(options); assert.equal((await h.actions.claimEquipmentAlerts(id, token)).ok, false);
    assert.equal((await h.actions.dismissEquipmentAlert(id, other, token)).ok, false);
    assert.equal(h.calls.some((c) => c.name === 'claim_equipment_alerts'), false);
  }
});
test('invalid UUID and missing token are rejected before RPC', async () => {
  const h = serverActions();
  for (const result of [await h.actions.syncEquipmentAlerts('bad'), await h.actions.claimEquipmentAlerts(id, undefined), await h.actions.ackEquipmentAlert(id, 'bad', token)]) assert.equal(result.ok, false);
  assert.equal(h.calls.length, 0);
});
test('stale token or resolved alert errors never report success or leak database detail', async () => {
  for (const code of ['42501', '55000', 'XX000']) {
    const h = serverActions({ error: { code, message: 'private detail' } });
    const result = await h.actions.dismissEquipmentAlert(id, other, token);
    assert.equal(result.ok, false); assert.doesNotMatch(result.message, /private/);
  }
});
function audioHarness(blocked = false) {
  const statuses = [], oscillators = [], storage = [];
  const ctx = { state: 'suspended', currentTime: 0, destination: {}, async resume() { if (blocked) throw new Error('blocked'); ctx.state = 'running'; }, async close() { ctx.state = 'closed'; },
    createOscillator() { const osc = { frequency: {}, connect() {}, disconnect() {}, start() {}, stop() {} }; oscillators.push(osc); return osc; },
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }) };
  const { EquipmentAlertAudio } = load('alert-audio.ts', {}, { localStorage: { setItem: (...args) => storage.push(args) } });
  let created = 0;
  const audio = new EquipmentAlertAudio((status) => statuses.push(status), () => { created++; return ctx; });
  return { audio, statuses, oscillators, storage, created: () => created, ctx };
}
test('audio requires explicit gesture; test sound is bounded and critical is stronger', async () => {
  const h = audioHarness(); assert.equal(h.created(), 0); h.audio.play('warning'); assert.deepEqual(h.statuses, ['required']);
  await h.audio.enable(); assert.equal(h.created(), 1); h.audio.play('warning'); assert.equal(h.oscillators.length, 1);
  h.audio.play('critical'); assert.equal(h.oscillators.length, 4); assert.equal(h.storage.length, 1); h.audio.close();
});
test('autoplay failures report blocked without throwing; saved preference does not auto-enable', async () => {
  const h = audioHarness(true); await h.audio.enable(); assert.equal(h.statuses.at(-1), 'blocked');
  h.audio.play('warning'); assert.equal(h.oscillators.length, 0); h.audio.close();
  const newSession = audioHarness(); assert.equal(newSession.created(), 0); newSession.audio.close();
});
const uiMocks = { './equipment-realtime': { watchEquipment() { return () => {}; } }, './alert-actions': {},
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) } };
test('warning/critical dialogs have Hebrew text, RTL, serial, negative time and one dialog', () => {
  const ui = load('equipment-alerts-provider.tsx', uiMocks);
  for (const severity of ['warning', 'critical']) {
    const r = { ...row, alert: { ...alert, severity, accumulated_active_seconds: severity === 'critical' ? 7955 : 5500 } };
    const html = renderToStaticMarkup(React.createElement(ui.EquipmentAlertDialog, { row: r, serverTime: base, count: 2, presented() {}, dismiss: async () => {} }));
    assert.ok(html.includes(`class="dialog ${severity}"`)); assert.ok(html.includes(model.alertLabels[severity]));
    assert.ok(html.includes('dir="rtl"')); assert.ok(html.includes('SN-7')); assert.ok(html.includes('סגור וחזור בעוד 5 דקות'));
    if (severity === 'critical') assert.ok(html.includes('-00:12:35'));
    assert.equal((html.match(/<dialog/g) ?? []).length, 1);
  }
});
test('operator sees enable/test sound controls; viewer has no alert operations UI', () => {
  const ui = load('equipment-alerts-provider.tsx', uiMocks);
  const render = (canOperate) => renderToStaticMarkup(React.createElement(ui.EquipmentAlertsProvider, { incidentId: id, userId: id, canRead: true, canOperate }, React.createElement('p', null, 'תוכן האירוע')));
  assert.ok(render(true).includes('הפעל צלילי התראה')); assert.ok(render(true).includes('בדיקת צליל')); assert.ok(!render(false).includes('<button'));
});
test('provider cleans intervals/subscription/listeners and focus/visibility cause resync', async () => {
  const effects = [], listeners = {}, timers = new Map(), calls = []; let i = 0;
  const hooks = { ...React, useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}], useEffect: (fn) => effects.push(fn) };
  class Controller { constructor() {} resume() { calls.push('resume'); } suspend() { calls.push('suspend'); } stop() { calls.push('stop'); } tick() { calls.push('tick'); } requestSync() { calls.push('sync'); } }
  const win = { addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener(name) { delete listeners[name]; }, setInterval(fn, ms) { timers.set(++i, { fn, ms }); return i; }, clearInterval(key) { timers.delete(key); } };
  const doc = { visibilityState: 'visible', addEventListener: win.addEventListener, removeEventListener: win.removeEventListener };
  const ui = load('equipment-alerts-provider.tsx', { ...uiMocks, react: hooks,
    './equipment-realtime': { watchEquipment() { calls.push('subscribe'); return () => calls.push('unsubscribe'); } },
    './alert-controller': { EquipmentAlertController: Controller } }, { window: win, document: doc });
  ui.EquipmentAlertsProvider({ incidentId: id, userId: id, canRead: true, canOperate: true, children: null });
  const cleanup = effects[0](); listeners.focus(); doc.visibilityState = 'hidden'; listeners.visibilitychange(); doc.visibilityState = 'visible'; listeners.visibilitychange();
  assert.equal(calls.filter((c) => c === 'resume').length, 3); assert.ok(calls.includes('suspend'));
  assert.deepEqual([...timers.values()].map((t) => t.ms), [25000, 1000]); cleanup();
  assert.equal(timers.size, 0); assert.equal(Object.keys(listeners).length, 0); assert.ok(calls.includes('unsubscribe')); assert.ok(calls.includes('stop'));
});
test('migration publishes only scoped signals, fixed paths/private functions, no catalog grants', () => {
  const sql = fs.readFileSync(path.resolve(root, '../../../../../supabase/migrations/20260917100000_equipment_realtime_alert_shell.sql'), 'utf8');
  assert.match(sql, /using \(public.can_read_equipment_incident\(incident_id\)\)/);
  assert.match(sql, /d.user_id=v_actor/); assert.match(sql, /references public.incidents\(id\) on delete cascade/);
  assert.equal((sql.match(/add table public\./g) ?? []).length, 1);
  assert.match(sql, /add table public.equipment_incident_signals/);
  assert.doesNotMatch(sql, /grant select on public.equipment_(items|types|alert_deliveries)/);
  assert.equal((sql.match(/security definer set search_path = pg_catalog, public/g) ?? []).length, 3);
  assert.match(sql, /revoke all on function public.emit_equipment_incident_signal/);
});
