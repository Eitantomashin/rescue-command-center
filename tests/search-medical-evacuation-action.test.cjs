const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const action = fs.readFileSync(path.join(root, "app/mobile/search/actions.ts"), "utf8");
const kpi = fs.readFileSync(path.join(root, "app/mobile/search/search-operational-kpis.tsx"), "utf8");
const card = fs.readFileSync(path.join(root, "app/mobile/search/search-unit-card.tsx"), "utf8");
const casualty = fs.readFileSync(path.join(root, "lib/search-casualty-person.ts"), "utf8");

test("evacuation action uses only the installed secure RPC and returns a safe structured result", () => {
  assert.match(action, /supabase\.rpc\("mark_search_resident_evacuated", \{ p_resident_id: residentId \}\)/);
  assert.match(action, /MarkSearchResidentEvacuatedResult/);
  assert.doesNotMatch(action, /from\("unit_residents"\)\.update/);
  assert.match(action, /לא ניתן היה לעדכן את הפינוי הרפואי/);
});

test("shared drilldown offers evacuation only to editable waiting physical casualties", () => {
  assert.match(kpi, /canMarkEvacuated && evacuation === "waiting"/);
  assert.match(kpi, /window\.confirm/);
  assert.match(kpi, /markSearchResidentEvacuated\(person\.residentId\)/);
  assert.match(kpi, /router\.refresh\(\)/);
  assert.match(kpi, /pending === person\.residentId/);
  assert.match(kpi, /evacuation === "evacuated" \? "פונה"/);
});

test("card displays structured evacuation state, locks evacuation requirement after evacuation, and does not save timestamp", () => {
  assert.match(card, /מצב פינוי:/);
  assert.match(card, /פונה ב:/);
  assert.match(card, /Boolean\(resident\.evacuated_at\)/);
  assert.match(action, /const \{ evacuated_at: _evacuatedAt, \.\.\.residentData \} = row/);
  assert.match(casualty, /timeZone: "Asia\/Jerusalem"/);
  assert.match(casualty, /hour: "2-digit", minute: "2-digit"/);
});
