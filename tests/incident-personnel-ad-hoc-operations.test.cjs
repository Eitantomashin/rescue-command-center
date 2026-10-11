const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../app/(protected)/incidents/[incidentId]/personnel");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");
const page = source("page.tsx");
const panels = source("incident-personnel-action-panels.tsx");
const actions = source("actions.ts");

test("page loads operational roles and a dedicated ad-hoc management permission", () => {
  assert.match(page, /operational_role/);
  assert.match(page, /supabase\.rpc\("current_user_role"\)/);
  assert.match(page, /supabase\.rpc\("can_view_incident", \{ p_incident_id: params\.incidentId \}\)/);
  assert.match(page, /systemRole === "admin" \|\| systemRole === "commander"/);
  assert.match(page, /canManageAdHocTeams=\{canManageAdHocTeams\}/);
});

test("operational role labels and release wording are explicit Hebrew UI contracts", () => {
  for (const text of ["חבר/ת צוות", "מפקד/ת", "סגן/ית מפקד", "שחרר מצוות אד־הוק"]) {
    assert.ok(panels.includes(text), text);
  }
  assert.match(panels, /הנוכחות והשיוך האורגני אינם משתנים/);
  assert.match(panels, /מפקד\/ת \(תיאור צוות\):/);
});

test("transfer only presents other active ad-hoc teams", () => {
  assert.match(panels, /team\.status === "active" && team\.id !== sourceTeamId/);
  assert.match(panels, /targetAdHocTeamId/);
  assert.match(panels, /targetOperationalRole/);
});

test("new server actions use installed RPCs with exact named payloads and revalidate only after success", () => {
  for (const rpc of [
    "set_incident_ad_hoc_team_member_role",
    "transfer_incident_ad_hoc_team_member",
    "return_incident_ad_hoc_team_member"
  ]) assert.match(actions, new RegExp(`supabase\\.rpc\\("${rpc}"`));
  for (const parameter of [
    "p_operational_role: operationalRole",
    "p_target_ad_hoc_team_id: targetAdHocTeamId",
    "p_target_operational_role: targetOperationalRole",
    "p_notes: value(formData, \"notes\") || null"
  ]) assert.ok(actions.includes(parameter), parameter);
  assert.match(actions, /friendlyAdHocManagementError/);
  for (const code of ["42501", "22023", "23505", "55000", "P0002"]) assert.ok(actions.includes(code), code);
  assert.equal((actions.match(/await revalidatePersonnel\(incidentId\);/g) ?? []).length >= 7, true);
});

test("legacy personnel and ad-hoc actions remain available", () => {
  for (const action of [
    "createAdHocTeamAction", "updateAdHocTeamAction", "addExistingAdHocMemberAction",
    "addManualAdHocMemberAction", "removeAdHocTeamMemberAction", "archiveAdHocTeamAction"
  ]) assert.ok(actions.includes(`function ${action}`) || actions.includes(`function ${action}(`), action);
  assert.match(panels, /ManualPersonnelForm/);
  assert.match(panels, /CreateAdHocTeamForm/);
  assert.match(panels, /EditAdHocTeamForm/);
  assert.match(panels, /ExistingMemberForm/);
  assert.match(panels, /ManualAdHocMemberForm/);
});
