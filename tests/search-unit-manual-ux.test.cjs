const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function loadLabelLogic() {
  const source = fs.readFileSync(path.join(root, "lib/search-unit-label.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Map });
  return module.exports;
}

test("manual search unit uses the entered field label and preserves a legacy fallback", () => {
  const { reportedManualSearchUnitLabel, searchUnitDisplayLabel } = loadLabelLogic();
  const notes = "מספר דירה שדווח בשטח: דירה 2 מפוצלת\nהערה";
  assert.equal(reportedManualSearchUnitLabel(notes), "דירה 2 מפוצלת");
  assert.equal(searchUnitDisplayLabel({ unit_number: "manual-search-1", zone_type: "other", zone_name: "הוספה ידנית", zone_sequence: 1, notes }), "דירה 2 מפוצלת");
  assert.equal(searchUnitDisplayLabel({ unit_number: "manual-search-1", zone_type: "other", zone_name: "הוספה ידנית", zone_sequence: 1, notes: null }), "הוספה ידנית 1");
});

test("mobile and protected Search Site creation use the same canonical action", () => {
  const mobile = fs.readFileSync(path.join(root, "app/mobile/search/mobile-search-ui.tsx"), "utf8");
  const protectedPage = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx"), "utf8");
  const action = fs.readFileSync(path.join(root, "app/mobile/search/actions.ts"), "utf8");
  const form = fs.readFileSync(path.join(root, "app/mobile/search/manual-search-unit-form.tsx"), "utf8");
  assert.ok(mobile.includes("<ManualSearchUnitForm incidentId={site.incident_id} siteId={site.id} floorId={floor.id}"));
  assert.ok(protectedPage.includes("<ManualSearchUnitForm incidentId={incidentId} siteId={site.id} floorId={floor.id}"));
  assert.ok(protectedPage.includes("<ManualSearchUnitForm incidentId={params.incidentId} siteId={params.siteId} floorId={floor.id}"));
  assert.ok(form.includes("action={formAction}"));
  assert.ok(action.includes('rpc("add_search_site_manual_unit"'));
  assert.ok(action.includes("revalidateSearchSiteViews(paths)"));
});

test("save feedback is a three-second success-only toast while errors remain server errors", () => {
  const card = fs.readFileSync(path.join(root, "app/mobile/search/search-unit-card.tsx"), "utf8");
  const action = fs.readFileSync(path.join(root, "app/mobile/search/actions.ts"), "utf8");
  assert.ok(card.includes("const [showSaveSuccess, setShowSaveSuccess] = useState(false)"));
  assert.ok(card.includes("setShowSaveSuccess(true)"));
  assert.ok(card.includes("setTimeout(() => { setShowSaveSuccess(false); successTimer.current = null; }, 3000)"));
  assert.ok(card.includes('role="status">השמירה בוצעה</p>'));
  assert.ok(card.includes("router.refresh()"));
  assert.ok(action.includes("if (error) throw new Error(error.message);"));
});
test("manual labels and save feedback preserve the existing resident source", () => {
  const mobilePage = fs.readFileSync(path.join(root, "app/mobile/search/[incidentId]/[siteId]/page.tsx"), "utf8");
  const mobile = fs.readFileSync(path.join(root, "app/mobile/search/mobile-search-ui.tsx"), "utf8");
  const card = fs.readFileSync(path.join(root, "app/mobile/search/search-unit-card.tsx"), "utf8");
  assert.ok(mobilePage.includes('from("unit_residents")'));
  assert.ok(mobilePage.includes("residentsByUnit={residentsByUnit}"));
  assert.ok(mobile.includes("residents: (residentsByUnit.get(unit.id) ?? []).map"));
  assert.ok(card.includes("useState(initial.knownPeopleCount === null ? \"\" : String(initial.knownPeopleCount))"));
  assert.ok(!card.includes("initialResidentCountForCard"));
  assert.ok(card.includes('role="status">השמירה בוצעה</p>'));
});

test("manual apartment creation locks repeated submits and only reports confirmed success", () => {
  const form = fs.readFileSync(path.join(root, "app/mobile/search/manual-search-unit-form.tsx"), "utf8");
  const action = fs.readFileSync(path.join(root, "app/mobile/search/actions.ts"), "utf8");
  assert.ok(form.includes("const submissionLocked = useRef(false)"));
  assert.ok(form.includes("if (submissionLocked.current)"));
  assert.ok(form.includes("event.preventDefault()"));
  assert.ok(form.includes("submissionLocked.current = true"));
  assert.ok(form.includes("setSubmitting(true)"));
  assert.ok(form.includes('isPending ? "מוסיף..." : "הוסף דירה"'));
  assert.ok(form.includes("disabled={isPending}"));
  assert.ok(form.includes('role="status">הדירה נוספה בהצלחה</p>'));
  assert.ok(form.includes("setTimeout(() => {"));
  assert.ok(form.includes("}, 3000)"));
  assert.ok(form.includes("if (!state.success)"));
  assert.ok(form.includes("router.refresh()"));
  assert.ok(action.includes("return { success: false, error: error.message"));
  assert.ok(action.includes("return { success: true, error: null"));
  assert.ok(!action.includes("redirect("));
});

test("manual apartment form keeps floor context, canonical labels, residents, and canonical counts", () => {
  const form = fs.readFileSync(path.join(root, "app/mobile/search/manual-search-unit-form.tsx"), "utf8");
  const label = fs.readFileSync(path.join(root, "lib/search-unit-label.ts"), "utf8");
  const mobilePage = fs.readFileSync(path.join(root, "app/mobile/search/[incidentId]/[siteId]/page.tsx"), "utf8");
  const card = fs.readFileSync(path.join(root, "app/mobile/search/search-unit-card.tsx"), "utf8");
  assert.ok(form.includes('name="floorId" value={floorId}'));
  assert.ok(form.includes('name="reportedUnitNumber"'));
  assert.ok(label.includes("reportedManualSearchUnitLabel"));
  assert.ok(mobilePage.includes("residentsByUnit={residentsByUnit}"));
  assert.ok(card.includes("String(initial.knownPeopleCount)"));
  assert.ok(!card.includes("initialResidentCountForCard"));
});
