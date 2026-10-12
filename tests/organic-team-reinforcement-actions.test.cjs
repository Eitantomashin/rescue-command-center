const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const actions = fs.readFileSync(
  path.resolve(__dirname, "../app/(protected)/incidents/[incidentId]/personnel/actions.ts"),
  "utf8"
);

function actionBody(name) {
  const start = actions.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} must be exported`);
  const end = actions.indexOf("\nexport async function ", start + 1);
  return actions.slice(start, end === -1 ? actions.length : end);
}

test("organic reinforcement actions call the installed RPCs with their exact named parameters", () => {
  const assign = actionBody("assignOrganicTeamReinforcementAction");
  assert.match(assign, /supabase\.rpc\("assign_incident_organic_team_reinforcement"/);
  for (const parameter of [
    "p_incident_id: incidentId",
    "p_target_team_id: targetTeamId",
    "...personnelPayload",
    "p_notes: optionalValue(formData, \"notes\")"
  ]) assert.ok(assign.includes(parameter), parameter);

  const transfer = actionBody("transferOrganicTeamReinforcementAction");
  assert.match(transfer, /supabase\.rpc\("transfer_incident_organic_team_reinforcement"/);
  for (const parameter of [
    "p_incident_id: incidentId",
    "p_reinforcement_id: reinforcementId",
    "p_target_team_id: targetTeamId",
    "p_notes: optionalValue(formData, \"notes\")"
  ]) assert.ok(transfer.includes(parameter), parameter);

  const returnAction = actionBody("returnOrganicTeamReinforcementAction");
  assert.match(returnAction, /supabase\.rpc\("return_incident_organic_team_reinforcement"/);
  for (const parameter of [
    "p_incident_id: incidentId",
    "p_reinforcement_id: reinforcementId",
    "p_notes: optionalValue(formData, \"notes\")"
  ]) assert.ok(returnAction.includes(parameter), parameter);
});

test("assignment validates UUID inputs and distinguishes regular from manual personnel before calling the database", () => {
  assert.match(actions, /function isUuid\(raw: string\)/);
  assert.match(actions, /function organicReinforcementPersonnelPayload\(personnelKey: string\)/);
  assert.match(actions, /\^\(roster\|manual\):/);
  assert.match(actions, /p_unit_personnel_id: match\[2\], p_manual_personnel_id: null/);
  assert.match(actions, /p_unit_personnel_id: null, p_manual_personnel_id: match\[2\]/);

  const assign = actionBody("assignOrganicTeamReinforcementAction");
  assert.match(assign, /!isUuid\(incidentId\) \|\| !isUuid\(targetTeamId\) \|\| !personnelPayload/);
  assert.match(assign, /יש לבחור מחלץ וצוות יעד תקינים לתגבור/);
  assert.doesNotMatch(assign.slice(0, assign.indexOf('const supabase = createClient()')), /supabase\.rpc/);
});

test("organic reinforcement actions return focused Hebrew errors, log failures, and revalidate only after successful RPC calls", () => {
  assert.match(actions, /function friendlyOrganicTeamReinforcementError/);
  for (const code of ["42501", "22023", "23505", "55000", "P0002"]) assert.ok(actions.includes(code), code);

  for (const name of [
    "assignOrganicTeamReinforcementAction",
    "transferOrganicTeamReinforcementAction",
    "returnOrganicTeamReinforcementAction"
  ]) {
    const body = actionBody(name);
    assert.match(body, new RegExp(`logServerActionError\\("${name}"`));
    assert.match(body, /friendlyOrganicTeamReinforcementError\(error\)/);
    assert.match(body, /await revalidatePersonnel\(incidentId\);/);
    assert.match(body, /if \(error\)[\s\S]*?return \{ error:/);
    assert.ok(body.indexOf("if (error)") < body.indexOf("await revalidatePersonnel(incidentId);"));
  }
});
