const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const presencePath = path.join(root, "app/(protected)/incidents/[incidentId]/incident-presence.tsx");
const mobileLayoutPath = path.join(root, "app/mobile/search/[incidentId]/layout.tsx");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("mobile incident routes mount the shared incident presence provider once", () => {
  const layout = read(mobileLayoutPath);

  assert.match(layout, /import \{ IncidentPresenceProvider \} from "@\/app\/\(protected\)\/incidents\/\[incidentId\]\/incident-presence"/);
  assert.match(layout, /<IncidentPresenceProvider/);
  assert.match(layout, /incidentId=\{params\.incidentId\}/);
  assert.match(layout, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(layout, /supabase\.channel\(/);
});

test("shared provider maps mobile list and site routes to the incident presence channel", () => {
  const source = read(presencePath);

  assert.match(source, /supabase\.channel\(`incident:\$\{incidentId\}:presence`/);
  assert.match(source, /const mobileBase = `\/mobile\/search\/\$\{incidentId\}`/);
  assert.match(source, /screenKey: "mobile-search-sites"/);
  assert.match(source, /screenKey: "mobile-search-site"/);
  assert.match(source, /mobileSearch/);
  assert.match(source, /lastSeenAt: new Date\(\)\.toISOString\(\)/);
  assert.match(source, /const HEARTBEAT_MS = 20000/);
  assert.match(source, /const STALE_PRESENCE_MS = 90000/);
});

test("presence keeps distinct user IDs while retaining the newest entry for duplicate sessions", () => {
  const entries = [
    { userId: "desktop-user", lastSeenAt: "2026-10-06T10:00:00.000Z" },
    { userId: "mobile-user", lastSeenAt: "2026-10-06T10:00:00.000Z" },
    { userId: "desktop-user", lastSeenAt: "2026-10-06T10:01:00.000Z" }
  ];
  const byUser = new Map();

  for (const entry of entries) {
    const previous = byUser.get(entry.userId);
    if (!previous || new Date(entry.lastSeenAt) > new Date(previous.lastSeenAt)) {
      byUser.set(entry.userId, entry);
    }
  }

  assert.equal(byUser.size, 2);
  assert.equal(byUser.get("desktop-user").lastSeenAt, "2026-10-06T10:01:00.000Z");
  assert.ok(byUser.has("mobile-user"));
});

test("desktop presence route handling and userId deduplication remain in the shared provider", () => {
  const source = read(presencePath);

  assert.match(source, /const base = `\/incidents\/\$\{incidentId\}`/);
  assert.match(source, /screenKey: "dashboard"/);
  assert.match(source, /const byUser = new Map<string, PresenceUser>\(\)/);
  assert.match(source, /byUser\.set\(presence\.userId, presence\)/);
});
