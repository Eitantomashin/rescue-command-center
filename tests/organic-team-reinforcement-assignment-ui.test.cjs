const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const panel = fs.readFileSync(
  path.resolve(__dirname, "../app/(protected)/incidents/[incidentId]/personnel/incident-personnel-action-panels.tsx"),
  "utf8"
);
const page = fs.readFileSync(
  path.resolve(__dirname, "../app/(protected)/incidents/[incidentId]/personnel/page.tsx"),
  "utf8"
);

test("organic reinforcement form uses the existing server action with the exact FormData field names", () => {
  assert.match(panel, /useFormState\(assignOrganicTeamReinforcementAction, initialState\)/);
  for (const field of ["incidentId", "personnelKey", "targetTeamId", "notes"]) {
    assert.match(panel, new RegExp(`name=\\"${field}\\"`));
  }
  assert.match(panel, /תגבור זמני בין צוותים אורגניים/);
  assert.match(panel, /label="תגבר לצוות"/);
  assert.match(panel, /<ActionMessage state=\{state\} \/>/);
});

test("organic reinforcement UI filters target teams by source, respects authorization, and stays inactive without the migration", () => {
  assert.match(panel, /targetTeams\.filter\(\(team\) => team\.id !== selectedPerson\.organicTeam\.id\)/);
  assert.match(panel, /!canManage \|\| !available \|\| !incidentIsActive \|\| candidates\.length === 0/);
  assert.match(page, /missingOrganicTeamReinforcementsTable/);
  assert.match(page, /תשתית התגבור האורגני אינה זמינה בסביבה זו/);
  assert.match(panel, /לא ניתן לטעון כרגע את נתוני התגבור האורגני/);
  assert.match(panel, /ניהול תגבור אורגני זמין למנהל מערכת או מפקד בלבד/);
  assert.match(panel, /sourceKind === "roster" \? "סגל קבוע" : "נוסף ידנית"/);
});

test("personnel page supplies active target teams, eligible personnel, and a distinct management permission", () => {
  assert.match(page, /buildEligibleOrganicTeamReinforcementCandidates/);
  assert.match(page, /activeReinforcementKeys/);
  assert.match(page, /activeAdHocMemberKeys/);
  assert.match(page, /organicTeamReinforcementTargetTeams=\{organicTeamReinforcementModel\.activeTargetTeams\}/);
  assert.match(page, /organicTeamReinforcementAvailable=\{operationalTeamRosterDataAvailable && incidentLifecycleAvailable\}/);
  assert.match(page, /const canManageOrganicTeamReinforcements = Boolean\(canViewIncident\) && \(systemRole === "admin" \|\| systemRole === "commander"\)/);
});

test("active organic reinforcements use the installed transfer and return actions, with safe target filtering", () => {
  assert.match(panel, /useFormState\(transferOrganicTeamReinforcementAction, initialState\)/);
  assert.match(panel, /useFormState\(returnOrganicTeamReinforcementAction, initialState\)/);
  assert.match(panel, /name="reinforcementId" value=\{reinforcement\.id\}/);
  assert.match(panel, /team\.id !== reinforcement\.operationalTeam\.id && team\.id !== reinforcement\.organicTeam\.id/);
  assert.match(panel, /label="העבר לצוות אחר"/);
  assert.match(panel, /label="החזר לצוות המקורי"/);
  assert.match(panel, /window\.confirm\(confirmation\)/);
});

test("active reinforcement UI remains readable but never exposes management controls for inactive incidents or unavailable data", () => {
  assert.match(panel, /תגבורים אורגניים פעילים/);
  assert.match(panel, /sourceKind === "roster" \? "סגל קבוע" : "נוסף ידנית"/);
  assert.match(panel, /!available \|\| !incidentIsActive \|\| !canManage/);
  assert.match(panel, /האירוע אינו פעיל, ולכן לא ניתן לנהל תגבור פעיל/);
  assert.match(panel, /האירוע אינו פעיל, ולכן לא ניתן להקצות תגבור אורגני/);
  assert.match(page, /select\("id,name,lifecycle_status,is_closed,archived_at"\)/);
  assert.match(page, /isIncidentActiveForOrganicTeamReinforcements/);
});

test("personnel UI renders operational roster data and reinforcement/ad-hoc labels without moving organic rows", () => {
  assert.match(panel, /מצבת כוח אדם מבצעית לפי צוות/);
  assert.match(panel, /אנשי צוותי אד־הוק אינם נכללים בסך הצוותים האורגניים/);
  assert.match(panel, /נוכחים אורגניים:/);
  assert.match(panel, /יצאו לתגבור:/);
  assert.match(panel, /נכנסו בתגבור:/);
  assert.match(panel, /מצבת כוח האדם המבצעית אינה זמינה כעת – לא ניתן לטעון את כל הנתונים הנדרשים/);
  assert.match(page, /מתגבר \{person\.organicTeamReinforcement\.operationalTeam\.name\}/);
  assert.match(page, /משויך לצוות אד־הוק/);
  assert.match(page, /calculateOperationalTeamRoster/);
});
