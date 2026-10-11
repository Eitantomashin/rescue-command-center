const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../app/(protected)/incidents/[incidentId]/personnel");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");
const actions = source("actions.ts");
const form = source("event-personnel-status-form.tsx");
const page = source("page.tsx");

function actionBody() {
  const start = actions.indexOf("export async function setEventPersonnelStatus(");
  const end = actions.indexOf("function friendlyPersonnelError", start);
  return actions.slice(start, end);
}

test("attendance update returns a success form state and revalidates only after a successful RPC", () => {
  const body = actionBody();
  assert.match(body, /Promise<PersonnelActionState>/);
  assert.match(body, /await revalidatePersonnel\(incidentId\);/);
  assert.match(body, /success: "סטטוס הנוכחות עודכן\."/);
  assert.doesNotMatch(body, /throw new Error/);
});

test("active ad-hoc attendance rejection maps only the focused 55000 database error to the operational guidance", () => {
  assert.match(actions, /function isActiveAdHocAttendanceBlock/);
  assert.match(actions, /code === "55000"/);
  assert.match(actions, /message\.includes\("לא ניתן לשנות נוכחות"\)/);
  assert.match(actions, /צוות אד\.\?הוק/);
  assert.match(actions, /לא ניתן לשנות את סטטוס הנוכחות\. המחלץ משויך לצוות אד־הוק פעיל\. יש לשחרר אותו מהצוות לפני שינוי הנוכחות\./);
});

test("general attendance failures are logged and rendered through the client form rather than an unhandled throw", () => {
  const body = actionBody();
  assert.match(body, /logServerActionError\("setEventPersonnelStatus", \{ incidentId, personnelId, attendanceStatus \}, error\)/);
  assert.match(body, /friendlyPersonnelError\(error\)/);
  assert.match(form, /useFormState\(setEventPersonnelStatus, initialState\)/);
  assert.match(form, /role="alert"/);
  assert.match(form, /role="status"/);
  assert.match(page, /<EventPersonnelStatusForm/);
  assert.match(page, /<CollaborativeLockSection objectType="event_personnel" objectId=\{person\.id\}>/);
});
