const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261006110000_search_unit_card_event_log_details.sql"), "utf8");

test("search apartment event snapshots active residents before mutation and reports resident changes", () => {
  for (const pattern of [
    /select coalesce\(jsonb_agg\(to_jsonb\(prior\) order by prior\.id\), '\[\]'::jsonb\)\s+into v_before_residents/s,
    /ur\.is_active=true\s+for update of ur/s,
    /'נוסף דייר: ' \|\| v_after_name/,
    /v_before_status_label[\s\S]*?→[\s\S]*?v_after_status_label/,
    /'נדרש פינוי: '/,
    /'הערות דייר עודכנו: '/,
    /'שם דייר עודכן: '/,
    /'הוסר דייר: '/
  ]) assert.match(sql, pattern);
});

test("search apartment event records only meaningful apartment deltas", () => {
  for (const pattern of [
    /'סטטוס דירה: ' \|\| v_old_search_status_label \|\| ' → ' \|\| v_new_search_status_label/,
    /'מספר דיירים ידוע: '/,
    /'דווח נזק לדירה'/,
    /'תיאור נזק עודכן'/,
    /'הערות דירה עודכנו'/
  ]) assert.match(sql, pattern);
  assert.match(sql, /if coalesce\(array_length\(v_changes, 1\), 0\) > 0 then\s+perform set_config[\s\S]*?insert into public\.event_logs/s);
  assert.equal((sql.match(/insert into public\.event_logs/g) || []).length, 1);
  assert.match(sql, /array_to_string\(v_changes, ' • '\)/);
});

test("search apartment event identifies the authenticated operator and preserves the RPC contract", () => {
  assert.match(sql, /v_actor_id uuid := public\.current_actor_id\(\)/);
  assert.match(sql, /select coalesce\(nullif\(btrim\(display_name\), ''\), v_actor_id::text\) into v_actor_name from public\.profiles where id=v_actor_id/);
  assert.match(sql, /now\(\),'חפ"ק',v_actor_name,'פרטי דירה עודכנו – קומה '/);
  assert.match(sql, /'actor_id',v_actor_id,'actor_name',v_actor_name,'changes',to_jsonb\(v_changes\)/);
  assert.doesNotMatch(sql, /'system'/i);
  assert.match(sql, /create or replace function public\.save_search_unit_card\(\s*p_site_id uuid, p_unit_id uuid, p_known_people_count integer, p_has_apartment_damage boolean default false,\s*p_apartment_damage_notes text default null, p_notes text default null, p_residents jsonb default '\[\]'::jsonb,\s*p_deactivate_resident_ids jsonb default '\[\]'::jsonb, p_action text default 'save'\s*\) returns uuid language plpgsql security definer set search_path = public as \$\$/s);
  assert.match(sql, /revoke all on function public\.save_search_unit_card\(uuid,uuid,integer,boolean,text,text,jsonb,jsonb,text\) from public/);
  assert.match(sql, /grant execute on function public\.save_search_unit_card\(uuid,uuid,integer,boolean,text,text,jsonb,jsonb,text\) to authenticated/);
});

test("event-log enrichment leaves the existing Search save semantics intact", () => {
  for (const pattern of [
    /assert_edit_search_site_data\(v_site\.incident_id\)/,
    /jsonb_array_length\(p_residents\) <> p_known_people_count/,
    /update public\.units set known_people_count=p_known_people_count/,
    /on conflict\(site_id,unit_id\) do update set occupants_count=excluded\.occupants_count/,
    /p_action='complete_casualties' and exists/,
    /return v_result_id/,
    /exception when others then\s+perform set_config\('rcc\.allow_event_log_insert', 'off', true\);\s+raise;/s
  ]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /insert into public\.persons|delete from public\.unit_residents|expected_occupants\s*=|initial_potential\s*=/i);
});
