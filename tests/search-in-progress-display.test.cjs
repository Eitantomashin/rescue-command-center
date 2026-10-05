const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib/search-site-status.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(compiled, { module: mod, exports: mod.exports, Set });
const status = mod.exports;

const card = fs.readFileSync(path.join(root, 'app/mobile/search/search-unit-card.tsx'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'app/mobile/search/mobile-search-ui.tsx'), 'utf8');
const protectedSite = fs.readFileSync(path.join(root, 'app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx'), 'utf8');
const commander = fs.readFileSync(path.join(root, 'app/(protected)/incidents/[incidentId]/search-sites-dashboard-widget.tsx'), 'utf8');
const route = fs.readFileSync(path.join(root, 'app/(protected)/incidents/[incidentId]/search-sites-widget-data/route.ts'), 'utf8');

test('canonical process labels cover every persisted apartment status without an unsafe not-visited fallback', () => {
  assert.equal(status.searchUnitProcessLabel('not_visited'), 'טרם התחילה סריקה');
  assert.equal(status.searchUnitProcessLabel('in_progress'), 'בסריקה');
  assert.equal(status.searchUnitProcessLabel('casualties'), 'בסריקה');
  assert.equal(status.searchUnitProcessLabel('no_answer'), 'אין מענה');
  assert.equal(status.searchUnitProcessLabel('clear'), 'סריקה הושלמה');
  assert.equal(status.searchUnitProcessLabel('completed'), 'סריקה הושלמה');
  assert.equal(status.searchUnitProcessLabel('future_status'), 'סטטוס סריקה לא ידוע');
  assert.equal(status.searchUnitStatusTone('in_progress'), 'in-progress');
});

test('shared card uses the canonical process label and never exposes a manual apartment-status control', () => {
  assert.match(card, /searchUnitProcessLabel\(initial\.status\)/);
  assert.match(card, /searchUnitStatusTone\(initial\.status\)/);
  assert.doesNotMatch(card, /name="searchStatus"/);
  assert.doesNotMatch(card, /initial\.status === "completed" \?/);
});

test('mobile, protected, commander, and widget route preserve and intentionally render in-progress', () => {
  assert.match(mobile, /type MobileSearchStatus = SearchUnitStatus/);
  assert.match(mobile, /in_progress: "בסריקה"/);
  assert.match(mobile, /return searchUnitStatusTone\(status\)/);
  assert.match(protectedSite, /if \(status === "in_progress"\) return "in-progress"/);
  assert.match(commander, /return searchUnitProcessLabel\(status\)/);
  assert.match(commander, /return searchUnitStatusTone\(status\)/);
  assert.match(route, /normalizeSearchUnitStatus\(result\?\.search_status\)/);
});