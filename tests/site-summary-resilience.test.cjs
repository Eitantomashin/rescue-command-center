const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const layout = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/layout.tsx"), "utf8");
const sitesPage = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/sites/page.tsx"), "utf8");
const shell = fs.readFileSync(path.join(root, "app/(protected)/incidents/[incidentId]/incident-command-shell.tsx"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261005150000_unit_residents_active_linked_person_index.sql"), "utf8");

test("navigation prefers dashboard summaries but derives every site and its order from sites metadata", () => {
  assert.match(layout, /\{ data: sites, error: sitesError \}/);
  assert.match(layout, /\.eq\("is_active", true\)\s*\.order\("site_number", \{ ascending: true \}\)/);
  assert.match(layout, /const summaryBySite = new Map\(\(\(sites \?\? \[\]\) as SiteRow\[\]\)\.map/);
  assert.match(layout, /const shellSites: SiteRow\[\] = siteMetadataRowsTyped\s*\.filter\(\(site\) => !isSearchUser \|\| site\.site_type === "search_site"\)\s*\.map/);
  assert.match(layout, /const summarySite = sitesError \? undefined : summaryBySite\.get\(site\.id\)/);
  assert.match(layout, /updated_potential: summarySite\?\.updated_potential \?\? null/);
  assert.match(layout, /operational_gap: summarySite\?\.operational_gap \?\? null/);
  assert.match(layout, /total_sites: shellSites\.length/);
});

test("sites page retains rescue and search sites when the summary is missing or times out", () => {
  assert.match(sitesPage, /\.select\("id,site_number,name,city,street,house_number,site_type,search_status,search_reason,search_priority"\)/);
  assert.match(sitesPage, /const summarySite = error \? undefined : summaryBySite\.get\(site\.id\)/);
  assert.match(sitesPage, /site_type: site\.site_type \?\? "rescue_site"/);
  assert.match(sitesPage, /לא ניתן לטעון כרגע את נתוני הסיכום המבצעיים\. רשימת האתרים מוצגת ללא נתוני KPI/);
  assert.match(sitesPage, /residentImport === "success"/);
  assert.match(sitesPage, /רשימת הדיירים נטענה בהצלחה/);
  assert.match(sitesPage, /site\.updated_potential === null \? "—"/);
  assert.match(sitesPage, /site\.operational_gap === null \? "—"/);
});

test("navigation treats unavailable KPI values as unavailable rather than a zero operational gap", () => {
  assert.match(shell, /if \(site\.operational_gap === null \|\| site\.updated_potential === null\) \{\s*return "unknown";/);
  assert.match(shell, /site\.operational_gap !== null && site\.operational_gap > 0/);
});

test("dashboard lateral lookup receives an active linked-person partial index without changing the view", () => {
  assert.match(migration, /create index if not exists unit_residents_active_linked_person_idx/);
  assert.match(migration, /on public\.unit_residents \(linked_person_id\)\s*where is_active = true/);
  assert.doesNotMatch(migration, /statement_timeout|site_dashboard_summary|incident_dashboard_summary/i);
});
