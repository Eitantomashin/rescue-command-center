const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../app/(protected)/incidents/[incidentId]/sites/[siteId]/grid-map/site-grid-map.tsx"),
  "utf8"
);

const colors = new Set(["#2563eb", "#2E7D32", "#F58220", "#7c3aed", "#D32F2F"]);
function expectedSectorColor(color) {
  const normalized = color?.trim();
  return colors.has(normalized) ? normalized : "#2563eb";
}

test("an explicitly assigned sector color wins over searching, scanned, and completed status", () => {
  assert.equal(expectedSectorColor("#7c3aed"), "#7c3aed");
  assert.equal(expectedSectorColor("#D32F2F"), "#D32F2F");
  assert.match(source, /function sectorVisualColor\(sector: MapObject\)[\s\S]*?SECTOR_COLORS\.some/);
  assert.doesNotMatch(source, /function sectorVisualColor[\s\S]*?operationalStatus === "searching"/);
  assert.doesNotMatch(source, /function sectorVisualColor[\s\S]*?operationalStatus === "scanned"/);
  assert.doesNotMatch(source, /function sectorVisualColor[\s\S]*?operationalStatus === "completed"/);
  assert.doesNotMatch(source, /stroke=\{isSelected \? "#ffffff" : color\}/);
});

test("sectors without a valid explicit color use the stable blue fallback", () => {
  assert.equal(expectedSectorColor(null), "#2563eb");
  assert.equal(expectedSectorColor("not-a-sector-color"), "#2563eb");
  assert.match(source, /return SECTOR_COLORS\.some\(\(option\) => option\.value === color\) \? color : "#2563eb"/);
});
