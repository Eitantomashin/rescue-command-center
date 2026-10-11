/* Local-only automated concurrency harness for Stage 10.1B.2A.1. */
const { randomUUID } = require("crypto");
const { spawn } = require("child_process");
const { readFileSync } = require("fs");
const path = require("path");
const PROJECT_ID = "Rescue_Command_Center";
const CONTAINER = `supabase_db_${PROJECT_ID}`;
const DB = "postgres";
const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(ROOT, "supabase", "config.toml");
const args = new Set(process.argv.slice(2));
const runId = randomUUID();
const activeProcesses = new Set();
const FATAL_SQLSTATES = new Set(["40P01", "55P03", "57014"]);

function command(bin, args, input = "") {
  let tracked;
  tracked = new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    let settled = false;
    let childError;
    const settle = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result);
    };
    try {
      const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      child.stdout.on("data", (x) => { stdout += x; });
      child.stderr.on("data", (x) => { stderr += x; });
      // Keep the tracked promise active until close. An error event alone must not
      // allow cleanup while a child process is still terminating.
      child.on("error", (error) => { childError = error; });
      child.on("close", (code, signal) => {
        if (childError) return settle(childError);
        if (code === 0 && !signal) return settle(null, { stdout, stderr, code, signal });
        const error = new Error(`${bin} exited code=${code} signal=${signal || "none"}\n${stderr}\n${stdout}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        error.signal = signal;
        settle(error);
      });
      child.stdin.end(input);
    } catch (error) {
      settle(error);
    }
  });
  activeProcesses.add(tracked);
  tracked.then(() => activeProcesses.delete(tracked), () => activeProcesses.delete(tracked));
  return tracked;
}
async function waitForActiveProcesses() {
  // Never permit cleanup to race with a sibling psql session after a rejected promise.
  while (activeProcesses.size > 0) await Promise.allSettled([...activeProcesses]);
}
function psql(input) { return command("docker", ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB, "-At"], input); }
function q(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function prefix(f) {
  return `begin;
set local rcc.stage_10_1b_2a_1_concurrency_test_database='disposable-local';
select set_config('request.jwt.claim.sub',${q(f.admin)},true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
set local lock_timeout='15s';
set local statement_timeout='30s';`;
}
function assertNoFatalSqlState(output) {
  const states = [...String(output).matchAll(/\b(?:SQLSTATE\s*)?([0-9A-Z]{5})\b/g)].map((match) => match[1]);
  const fatal = states.find((state) => FATAL_SQLSTATES.has(state));
  if (fatal) throw new Error(`deadlock or timeout (${fatal}): ${output}`);
}
function sessionResult(output) {
  assertNoFatalSqlState(output);
  const results = [...String(output).matchAll(/RESULT\|(ok|error\|[0-9A-Z]{5})/g)].map((match) => match[1]);
  if (results.length !== 1) throw new Error(`expected exactly one RESULT marker, got ${results.length}: ${output}`);
  return results[0];
}
async function verifyTarget() {
  if (!args.has("--local-docker") || !args.has("--disposable-database") || !args.has(`--confirm-container=${CONTAINER}`)) {
    throw new Error(`Required: --local-docker --disposable-database --confirm-container=${CONTAINER}`);
  }
  const config = readFileSync(CONFIG_PATH, "utf8");
  if (!new RegExp(`^project_id\\s*=\\s*\"${PROJECT_ID}\"\\s*$`, "m").test(config)) {
    throw new Error(`Local Supabase config does not declare project_id=${PROJECT_ID}`);
  }
  const inspect = await command("docker", ["inspect", CONTAINER]);
  const container = JSON.parse(inspect.stdout)[0];
  const labels = container?.Config?.Labels || {};
  const hasProjectLabel = Object.entries(labels).some(([key, value]) =>
    /supabase|project/i.test(key) && value === PROJECT_ID,
  );
  if (
    !container || container.Name !== `/${CONTAINER}` || container.State?.Running !== true ||
    !/supabase\/postgres/i.test(container.Config?.Image || "") || !hasProjectLabel
  ) {
    throw new Error(`Isolation verification failed for ${CONTAINER}; expected a running local Supabase Postgres container labelled for ${PROJECT_ID}`);
  }
  const target = await psql("select current_database() || '|' || current_user || '|' || current_setting('data_directory');");
  if (!target.stdout.trim().startsWith(`${DB}|postgres|`)) throw new Error(`Unexpected PostgreSQL target: ${target.stdout.trim()}`);
  console.log(`Verified isolated local target: ${CONTAINER} / ${target.stdout.trim()}`);
}
function newFixture(label) {
  const tag = `stage-10-1b-2a-1-${runId}-${label}`;
  // Generated before the first INSERT so targeted cleanup remains possible if COMMIT
  // succeeds but psql output parsing or process communication subsequently fails.
  return {
    admin: randomUUID(), incident: randomUUID(), sourceTeam: randomUUID(), targetTeam: randomUUID(),
    archiveTeam: randomUUID(), transferPerson: randomUUID(), addPerson: randomUUID(),
    attendancePerson: randomUUID(), transferMember: randomUUID(), tag,
  };
}
async function fixture(label) {
  const f = newFixture(label);
  const setup = `begin;
select set_config('rcc.sql_editor_validation_mode','on',true);
select set_config('rcc.test_user_id',${q(f.admin)},true);
insert into auth.users(id,email,raw_user_meta_data) values(${q(f.admin)}::uuid,${q(`${f.tag}@invalid.local`)},'{}'::jsonb);
-- auth.users has the on_auth_user_created_create_profile trigger. Replace only its
-- just-created viewer profile so this disposable fixture has the required admin role.
delete from public.profiles where id=${q(f.admin)}::uuid;
insert into public.profiles(id,role,is_active,deleted_at) values(${q(f.admin)}::uuid,'admin',true,null);
insert into public.incidents(id,name,address,status_id,lifecycle_status,is_closed) values(${q(f.incident)}::uuid,${q(f.tag)},'Concurrency fixture',public.get_status_id('incident','active',null),'active',false);
insert into public.incident_ad_hoc_teams(id,incident_id,name,status) values
 (${q(f.sourceTeam)}::uuid,${q(f.incident)}::uuid,'Source','active'),
 (${q(f.targetTeam)}::uuid,${q(f.incident)}::uuid,'Target','active'),
 (${q(f.archiveTeam)}::uuid,${q(f.incident)}::uuid,'Archive','active');
insert into public.unit_personnel(id,first_name,last_name,role,department,is_active) values
 (${q(f.transferPerson)}::uuid,'Transfer','Person','rescuer','team_1',true),
 (${q(f.addPerson)}::uuid,'Add','Person','rescuer','team_1',true),
 (${q(f.attendancePerson)}::uuid,'Attendance','Person','rescuer','team_1',true);
insert into public.event_personnel_status(incident_id,personnel_id,attendance_status) values
 (${q(f.incident)}::uuid,${q(f.transferPerson)}::uuid,'present'),
 (${q(f.incident)}::uuid,${q(f.addPerson)}::uuid,'present'),
 (${q(f.incident)}::uuid,${q(f.attendancePerson)}::uuid,'present');
insert into public.incident_ad_hoc_team_members(id,incident_id,ad_hoc_team_id,unit_personnel_id,operational_role,is_active) values
 (${q(f.transferMember)}::uuid,${q(f.incident)}::uuid,${q(f.sourceTeam)}::uuid,${q(f.transferPerson)}::uuid,'member',true);
commit;`;
  try {
    await psql(setup);
    return f;
  } catch (error) {
    // The fixture transaction normally rolls back on a psql failure. If COMMIT succeeded
    // before the child process failed, retain the known tag for disposal with the local DB.
    console.error(`FIXTURE MAY BE RETAINED after setup failure: ${f.tag}`);
    throw error;
  }
}
async function retainFixture(f, outcome) {
  await waitForActiveProcesses();
  // event_logs are deliberately immutable and reference incidents without a cascade.
  // Never delete individual fixture rows: dispose of the isolated local database as a whole.
  console.log(`Fixture retained (${outcome}): ${f.tag}; discard the disposable local database after the suite.`);
}
async function race(name, f, actionA, actionB, expectedB, expectedA = "ok") {
  const sqlA = `${prefix(f)}
do $$ begin begin ${actionA} raise notice 'RESULT|ok'; exception when others then raise notice 'RESULT|error|%',sqlstate; end; end $$;
select pg_sleep(3); commit;`;
  const sqlB = `${prefix(f)}
do $$ begin begin ${actionB} raise notice 'RESULT|ok'; exception when others then raise notice 'RESULT|error|%',sqlstate; end; end $$;
commit;`;
  const started = Date.now();
  const a = psql(sqlA); await new Promise((r) => setTimeout(r, 400));
  const bStarted = Date.now();
  const b = psql(sqlB);
  // Do not let a rejected session short-circuit waiting for its sibling.
  const [aOutcome, bOutcome] = await Promise.allSettled([a, b]);
  const bElapsed = Date.now() - bStarted;
  if (aOutcome.status !== "fulfilled" || bOutcome.status !== "fulfilled") {
    const describe = (outcome) => outcome.status === "rejected" ? (outcome.reason?.stack || outcome.reason?.message || String(outcome.reason)) : "ok";
    throw new Error(`${name}: session process failure; A=${describe(aOutcome)}; B=${describe(bOutcome)}`);
  }
  const ra = sessionResult(`${aOutcome.value.stdout}\n${aOutcome.value.stderr}`);
  const rb = sessionResult(`${bOutcome.value.stdout}\n${bOutcome.value.stderr}`);
  if (bElapsed < 1500) throw new Error(`${name}: sessions did not overlap (B completed in ${bElapsed}ms)`);
  if (ra !== expectedA || rb !== expectedB) throw new Error(`${name}: A=${ra}, B=${rb}`);
  console.log(`PASS ${name}: A=${ra}; B=${rb}; elapsed_ms=${Date.now() - started}; B_wait_ms=${bElapsed}`);
}
async function verify(f, body) {
  const out = await psql(`${prefix(f)} do $$ begin ${body} end $$; rollback;`);
  assertNoFatalSqlState(`${out.stdout}\n${out.stderr}`);
}
async function scenario(name, work) {
  let f;
  let failure;
  try {
    f = await fixture(name);
    await work(f);
  } catch (error) { failure = error; }
  if (!f) throw failure;
  await retainFixture(f, failure ? "failed" : "passed");
  if (failure) throw failure;
}
(async () => {
  await verifyTarget();
  try {
    await scenario("add-transfer", async (f) => {
      await race("A add vs transfer", f,
        `perform public.transfer_incident_ad_hoc_team_member(${q(f.incident)}::uuid,${q(f.transferMember)}::uuid,${q(f.targetTeam)}::uuid);`,
        `perform public.add_incident_ad_hoc_team_member(${q(f.incident)}::uuid,${q(f.targetTeam)}::uuid,${q(f.addPerson)}::uuid,null);`, "ok");
      await verify(f, `if (select count(*) from public.incident_ad_hoc_team_members where incident_id=${q(f.incident)}::uuid and is_active and unit_personnel_id in (${q(f.transferPerson)}::uuid,${q(f.addPerson)}::uuid))<>2 then raise exception 'A inconsistent memberships'; end if; if exists(select 1 from public.incident_ad_hoc_team_members where id=${q(f.transferMember)}::uuid and is_active) then raise exception 'A source remained active'; end if;`);
      console.log("PASS A verification");
    });
    await scenario("transfer-return", async (f) => {
      await race("B transfer vs return", f,
        `perform public.transfer_incident_ad_hoc_team_member(${q(f.incident)}::uuid,${q(f.transferMember)}::uuid,${q(f.targetTeam)}::uuid);`,
        `perform public.return_incident_ad_hoc_team_member(${q(f.incident)}::uuid,${q(f.transferMember)}::uuid);`, "ok");
      await verify(f, `if (select count(*) from public.incident_ad_hoc_team_members where incident_id=${q(f.incident)}::uuid and unit_personnel_id=${q(f.transferPerson)}::uuid and is_active and ad_hoc_team_id=${q(f.targetTeam)}::uuid)<>1 then raise exception 'B expected one active target membership'; end if; if (select count(*) from public.event_logs where incident_id=${q(f.incident)}::uuid and log_type='incident_ad_hoc_member_returned')<>0 then raise exception 'B duplicate return audit'; end if;`);
      console.log("PASS B verification");
    });
    await scenario("add-archive", async (f) => {
      await race("C add vs archive", f,
        `perform public.archive_incident_ad_hoc_team(${q(f.incident)}::uuid,${q(f.archiveTeam)}::uuid);`,
        `perform public.add_incident_ad_hoc_team_member(${q(f.incident)}::uuid,${q(f.archiveTeam)}::uuid,${q(f.addPerson)}::uuid,null);`, "error|P0002");
      await verify(f, `if not exists(select 1 from public.incident_ad_hoc_teams where id=${q(f.archiveTeam)}::uuid and status='archived') then raise exception 'C archive did not win'; end if; if exists(select 1 from public.incident_ad_hoc_team_members where ad_hoc_team_id=${q(f.archiveTeam)}::uuid and is_active) then raise exception 'C archived team has member'; end if;`);
      console.log("PASS C verification");
    });
    await scenario("attendance-add", async (f) => {
      await race("D direct attendance update vs add", f,
        `update public.event_personnel_status set attendance_status='unavailable' where incident_id=${q(f.incident)}::uuid and personnel_id=${q(f.attendancePerson)}::uuid;`,
        `perform public.add_incident_ad_hoc_team_member(${q(f.incident)}::uuid,${q(f.targetTeam)}::uuid,${q(f.attendancePerson)}::uuid,null);`, "error|55000");
      await verify(f, `if (select attendance_status from public.event_personnel_status where incident_id=${q(f.incident)}::uuid and personnel_id=${q(f.attendancePerson)}::uuid)<>'unavailable' then raise exception 'D attendance did not update'; end if; if exists(select 1 from public.incident_ad_hoc_team_members where incident_id=${q(f.incident)}::uuid and unit_personnel_id=${q(f.attendancePerson)}::uuid and is_active) then raise exception 'D unavailable member was assigned'; end if;`);
      console.log("PASS D verification");
    });
    await scenario("attendance-transfer", async (f) => {
      await race("E direct attendance update vs transfer", f,
        `update public.event_personnel_status set attendance_status='unavailable' where incident_id=${q(f.incident)}::uuid and personnel_id=${q(f.transferPerson)}::uuid;`,
        `perform public.transfer_incident_ad_hoc_team_member(${q(f.incident)}::uuid,${q(f.transferMember)}::uuid,${q(f.targetTeam)}::uuid);`, "ok", "error|55000");
      await verify(f, `if (select attendance_status from public.event_personnel_status where incident_id=${q(f.incident)}::uuid and personnel_id=${q(f.transferPerson)}::uuid)<>'present' then raise exception 'E attendance changed'; end if; if (select count(*) from public.incident_ad_hoc_team_members where incident_id=${q(f.incident)}::uuid and unit_personnel_id=${q(f.transferPerson)}::uuid and is_active and ad_hoc_team_id=${q(f.targetTeam)}::uuid)<>1 then raise exception 'E target membership inconsistent'; end if; if exists(select 1 from public.incident_ad_hoc_team_members where id=${q(f.transferMember)}::uuid and is_active) then raise exception 'E source remained active'; end if;`);
      console.log("PASS E verification");
    });
    console.log("PASS: Stage 10.1B.2A.1 automated concurrency suite");
  } catch (error) { console.error(`FAIL: ${error.stack || error}`); process.exitCode = 1; }
})();
