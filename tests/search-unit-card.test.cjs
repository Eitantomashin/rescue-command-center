const { test } = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const ts = require('typescript'); const vm = require('node:vm');const root = path.resolve(__dirname, '..'); const code = ts.transpileModule(fs.readFileSync(path.join(root,'app/mobile/search/search-unit-card-logic.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText; const mod={exports:{}}; vm.runInNewContext(code,{module:mod,exports:mod.exports,Set}); const logic=mod.exports;test('unknown is null, while zero and one through ten remain distinct',()=>{assert.equal(logic.knownPeopleCount(''),null); assert.equal(logic.knownPeopleCount('0'),0); for(let i=1;i<=10;i++) assert.equal(logic.knownPeopleCount(String(i)),i); assert.equal(logic.knownPeopleCount('11'),null);});test('new resident defaults to not checked and clearance is explicit',()=>{assert.equal(logic.canClearSearchUnit(1,['not_checked'],false),false); assert.equal(logic.canClearSearchUnit(1,['resident_clear'],false),true);});test('anxiety, physical injury, and deceased are casualties',()=>{for(const status of ['anxiety_casualty','physical_casualty','deceased']) assert.equal(logic.hasResidentCasualty([status]),true); assert.equal(logic.canClearSearchUnit(1,['resident_clear'],true),false);});test('legacy medical evacuation normalizes to physical injury with evacuation',()=>assert.equal(JSON.stringify(logic.normalizeResidentStatus('medical_evacuation')),JSON.stringify({status_key:'physical_casualty',requires_evacuation:true})));test('required evacuation is counted for every casualty',()=>{const residents=[{first_name:'א',last_name:'',age:'',phone:'',notes:'',gender:'unknown',status_key:'physical_casualty',requires_evacuation:true},{first_name:'ב',last_name:'',age:'',phone:'',notes:'',gender:'female',status_key:'deceased',requires_evacuation:true}]; assert.equal(JSON.stringify(logic.residentSummary(residents)),JSON.stringify({total:2,clear:0,anxiety:0,physical:1,deceased:1,evacuation:2}));});test('decrease identifies active residents and confirmation cancellation leaves state external',()=>{const rows=[{id:'a',first_name:'',last_name:'',notes:'',status_key:'not_checked'},{id:'b',first_name:'דנה',last_name:'',notes:'',status_key:'resident_clear'}]; assert.deepEqual(logic.residentIdsLeavingActiveList(rows,1),['b']); assert.equal(logic.requiresResidentDecreaseConfirmation(rows,1),true);});test('card and action use new resident fields and no persons write',()=>{const card=fs.readFileSync(path.join(root,'app/mobile/search/search-unit-card.tsx'),'utf8'); const action=fs.readFileSync(path.join(root,'app/mobile/search/actions.ts'),'utf8'); assert.match(card,/requires_evacuation/); assert.match(card,/deceased/); assert.match(card,/לא ידוע/); assert.match(card,/בדירה דווחו נפגעים ו\/או חללים/); assert.doesNotMatch(action,/\.from\("persons"\)/);});test('refinement migration keeps legacy aggregates derived and protects RPC execution',()=>{const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261004120000_search_unit_resident_status_refinement.sql'),'utf8'); assert.match(sql,/requires_medical_evacuation boolean not null default false/); assert.match(sql,/'resident', 'deceased'/); assert.match(sql,/security definer/); assert.match(sql,/assert_edit_search_site_data/); assert.match(sql,/revoke all on function/); assert.match(sql,/medical_evacuation=excluded\.medical_evacuation/); assert.doesNotMatch(sql,/insert into public\.persons/i);});test('both search routes mount the shared card and protected route supplies the resident source of truth',()=>{const mobile=fs.readFileSync(path.join(root,'app/mobile/search/mobile-search-ui.tsx'),'utf8'); const protectedPage=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx'),'utf8'); assert.match(mobile,/return <SearchUnitCard/); assert.match(protectedPage,/return <SearchUnitCard/); assert.match(protectedPage,/known_people_count/); assert.match(protectedPage,/unit_residents/); assert.match(protectedPage,/requires_evacuation/); assert.match(protectedPage,/normalizeResidentStatus/); assert.doesNotMatch(protectedPage,/return \(<\s*article className=\{`search-unit-card/);});test('site creation and every current structural creator keep planning separate from operational residents',()=>{const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261004130000_search_population_site_creation.sql'),'utf8'); const b1=sql.slice(0,sql.indexOf('-- Stage 9.1D.2B-2')); const b2=sql.slice(sql.indexOf('-- Stage 9.1D.2B-2'),sql.indexOf('-- Stage 9.1D.2B-3')); assert.match(b1,/create or replace function public\.create_site_from_wizard/); assert.match(b1,/known_people_count,[\s\S]{0,500}?\n\s*0,/); assert.doesNotMatch(b1,/insert into public\.unit_residents/i); assert.match(b2,/create or replace function public\.add_apartment_to_floor/); assert.match(b2,/create or replace function public\.split_apartment_unit/); assert.match(b2,/v_position::text,\s*0,\s*true,[\s\S]{0,240}?\s*5,\s*'apartment_added'/); assert.match(b2,/v_base_label,\s*0,\s*true,[\s\S]{0,240}?\s*2,\s*'apartment_split'/); assert.match(b2,/expected_occupants = 2/); assert.doesNotMatch(b2,/dynamic_structure_create_placeholders/); assert.doesNotMatch(b2,/insert into public\.unit_residents/i);});test('B-3 deactivates only strict placeholders and reconciles only affected operational counts',()=>{const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261004130000_search_population_site_creation.sql'),'utf8'); const b3=sql.slice(sql.indexOf('-- Stage 9.1D.2B-3'),sql.indexOf('-- Stage 9.1D.2B-4')); for(const pattern of [/ur\.is_active = true/,/ur\.notes = 'placeholder'/,/ur\.first_name ~ '\^דייר \[0-9\]\+\$'/,/ur\.last_name is null/,/ur\.gender = 'unknown'/,/ur\.age is null/,/ur\.phone is null/,/ur\.linked_person_id is null/,/coalesce\(ur\.requires_medical_evacuation, false\) = false/,/st\.category = 'resident'/,/st\.status_key = 'missing'/]) assert.match(b3,pattern); assert.match(b3,/update public\.unit_residents ur\s+set is_active = false/); assert.match(b3,/returning ur\.id, ur\.unit_id/); assert.match(b3,/affected_units as materialized/); assert.match(b3,/not exists \(\s*select 1\s*from strict_placeholders sp\s*where sp\.id = ur\.id/s); assert.match(b3,/and u\.known_people_count is not null/); assert.match(b3,/count\(ur\.id\)::integer as active_resident_count/); assert.doesNotMatch(b3,/delete from public\.unit_residents/i); for(const field of ['search_status','initial_potential','expected_occupants','is_fully_cleared','casualty']) assert.doesNotMatch(b3,new RegExp('update public\\.(site_search_units|sites|units)[\\s\\S]{0,300}'+field,'i'));});test('B-4 saves only operational residents and preserves unknown versus zero',()=>{const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261004130000_search_population_site_creation.sql'),'utf8'); const card=fs.readFileSync(path.join(root,'app/mobile/search/search-unit-card.tsx'),'utf8'); const b4=sql.slice(sql.indexOf('-- Stage 9.1D.2B-4')); assert.match(b4,/p_known_people_count < 0 or p_known_people_count > 10/); assert.match(b4,/jsonb_array_length\(p_residents\) <> p_known_people_count/); assert.match(b4,/update public\.unit_residents ur\s+set is_active=false,updated_by=public\.current_actor_id\(\)/); for(const pattern of [/ur\.notes='placeholder'/,/ur\.first_name ~ '\^דייר \[0-9\]\+\$'/,/ur\.last_name is null/,/ur\.gender='unknown'/,/ur\.age is null/,/ur\.phone is null/,/ur\.linked_person_id is null/,/coalesce\(ur\.requires_medical_evacuation,false\)=false/,/st\.category='resident'/,/st\.status_key='missing'/]) assert.match(b4,pattern); assert.match(b4,/v_requires_evacuation := v_status_key='physical_casualty' and v_requires_evacuation/); assert.match(b4,/st\.status_key='deceased'/); assert.match(b4,/update public\.units set known_people_count=p_known_people_count/); assert.doesNotMatch(b4,/delete from public\.unit_residents/i); assert.doesNotMatch(b4,/insert into public\.persons/i); assert.doesNotMatch(b4,/expected_occupants\s*=/i); assert.doesNotMatch(b4,/initial_potential\s*=/i); assert.match(card,/מספר דיירים שדווחו בסריקה/); assert.match(card,/const submission = useMemo\(\(\) => residentSubmission\(residents, known\), \[residents, known\]\); const visible = submission\.residents;/); assert.match(card,/option value="">לא ידוע/); assert.match(card,/Array\.from\(\{length:11\}/);});test('unscanned-unit normalization changes only mismatched non-null counts without touching residents or search history',()=>{const followUp=path.join(root,'supabase/migrations/20261004140000_normalize_unscanned_unit_known_people_count.sql'); const applied=path.join(root,'supabase/migrations/20261004130000_search_population_site_creation.sql'); const sql=fs.readFileSync(followUp,'utf8'); assert.ok(fs.existsSync(applied)); assert.match(sql,/u\.known_people_count is not null/); assert.match(sql,/not exists \(\s*select 1\s*from public\.site_search_units ssu\s*where ssu\.unit_id = u\.id/s); assert.match(sql,/ur\.is_active = true/); assert.match(sql,/count\(ur\.id\)::integer as active_resident_count/); assert.match(sql,/u\.known_people_count <> c\.active_resident_count/); assert.match(sql,/set known_people_count = c\.active_resident_count/); assert.doesNotMatch(sql,/unit_residents\s+(set|update|delete|insert)/i); assert.doesNotMatch(sql,/(insert into|update|delete from) public\.site_search_units/i); assert.doesNotMatch(sql,/(insert into|update|delete from) public\.event_logs/i); assert.doesNotMatch(sql,/expected_occupants\s*=/i); assert.doesNotMatch(sql,/initial_potential\s*=/i);});test('smoke-test follow-up migration authorizes only the guarded save event-log insert and retains B-4 behaviour',()=>{  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261004150000_fix_search_unit_card_event_log_guard.sql'),'utf8');  const on=sql.indexOf("set_config('rcc.allow_event_log_insert', 'on', true)");  const insert=sql.indexOf('insert into public.event_logs',on);  const off=sql.indexOf("set_config('rcc.allow_event_log_insert', 'off', true)",insert);  assert.ok(on>=0 && insert>on && off>insert);  assert.match(sql,/security definer/); assert.match(sql,/set search_path = public/); assert.match(sql,/exception\s+when others then\s+perform set_config\('rcc\.allow_event_log_insert', 'off', true\);\s+raise;/s);  assert.match(sql,/assert_edit_search_site_data/); assert.match(sql,/for update/); assert.match(sql,/jsonb_array_length\(p_residents\) <> p_known_people_count/); assert.match(sql,/notes='placeholder'/); assert.match(sql,/update public\.units set known_people_count=p_known_people_count/);  assert.match(sql,/revoke all on function public\.save_search_unit_card/); assert.match(sql,/grant execute on function public\.save_search_unit_card[\s\S]*?to authenticated/);  assert.doesNotMatch(sql,/disable trigger|drop trigger|alter table public\.event_logs.*disable|grant\s+insert\s+on\s+public\.event_logs|create policy[\s\S]*event_logs/i);  assert.doesNotMatch(sql,/delete from public\.unit_residents|insert into public\.persons|expected_occupants\s*=|initial_potential\s*=/i);});test('successful saves refresh the current route without redirecting either caller',()=>{
  const protectedPage=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'app/mobile/search/mobile-search-ui.tsx'),'utf8');
  const card=fs.readFileSync(path.join(root,'app/mobile/search/search-unit-card.tsx'),'utf8');
  const action=fs.readFileSync(path.join(root,'app/mobile/search/actions.ts'),'utf8');
  const save=action.slice(action.indexOf('export async function saveSearchUnitCard'),action.indexOf('export async function addMobileSearchUnit'));
  assert.match(protectedPage,/returnSurface="protected"/);
  assert.match(mobile,/returnSurface="mobile"/);
  assert.match(card,/useRouter/);
  assert.match(card,/router\.refresh\(\)/);
  assert.match(card,/lastRefreshedVersion/);
  assert.match(save,/return \{ saved: true, refreshVersion: _previousState\.refreshVersion \+ 1 \};/);
  assert.doesNotMatch(save,/redirect\(/);
  assert.doesNotMatch(save,/revalidateSearchSiteViews/);
});
test('save validation and RPC failures remain errors instead of success states',()=>{
  const action=fs.readFileSync(path.join(root,'app/mobile/search/actions.ts'),'utf8');
  const save=action.slice(action.indexOf('export async function saveSearchUnitCard'),action.indexOf('export async function addMobileSearchUnit'));
  assert.match(save,/if \(knownPeopleCount !== null && knownPeopleCount > 10\) throw new Error\("ניתן להזין עד 10 דיירים"\);/);
  assert.match(save,/catch \{ throw new Error\("נתוני הדיירים אינם תקינים"\); \}/);
  assert.match(save,/if \(error\) throw new Error\(error\.message\);/);
  assert.match(save,/return \{ saved: true, refreshVersion: _previousState\.refreshVersion \+ 1 \};/);
});
test('resident submission deactivates only the persisted tail for 3 to 2 and 3 to 1',()=>{
  const residents=[{id:'id1'},{id:'id2'},{id:'id3'}];
  assert.equal(JSON.stringify(logic.residentSubmission(residents,2)),JSON.stringify({residents:[{id:'id1'},{id:'id2'}],deactivateResidentIds:['id3']}));
  assert.equal(JSON.stringify(logic.residentSubmission(residents,1)),JSON.stringify({residents:[{id:'id1'}],deactivateResidentIds:['id2','id3']}));
});
test('resident submission deactivates every persisted resident for positive to zero',()=>{
  const residents=[{id:'id1'},{id:'id2'},{id:'id3'}];
  assert.equal(JSON.stringify(logic.residentSubmission(residents,0)),JSON.stringify({residents:[],deactivateResidentIds:['id1','id2','id3']}));
});
test('resident submission preserves persisted residents when the count becomes unknown',()=>{
  const residents=[{id:'id1'},{id:'id2'}];
  assert.equal(JSON.stringify(logic.residentSubmission(residents,null)),JSON.stringify({residents,deactivateResidentIds:[]}));
});
test('resident submission never deactivates unsaved rows',()=>{
  const residents=[{id:'id1'},{first_name:'חדש'},{id:'id3'}];
  assert.equal(JSON.stringify(logic.residentSubmission(residents,1)),JSON.stringify({residents:[{id:'id1'}],deactivateResidentIds:['id3']}));
  assert.equal(JSON.stringify(logic.residentSubmission(residents,0)),JSON.stringify({residents:[],deactivateResidentIds:['id1','id3']}));
});
test('resident submission supports null to zero, zero to two, and two to three',()=>{
  assert.equal(JSON.stringify(logic.residentSubmission([{id:'id1'},{id:'id2'}],null)),JSON.stringify({residents:[{id:'id1'},{id:'id2'}],deactivateResidentIds:[]}));
  assert.equal(JSON.stringify(logic.residentSubmission([],0)),JSON.stringify({residents:[],deactivateResidentIds:[]}));
  assert.equal(JSON.stringify(logic.residentSubmission([{first_name:'א'},{first_name:'ב'}],2)),JSON.stringify({residents:[{first_name:'א'},{first_name:'ב'}],deactivateResidentIds:[]}));
  assert.equal(JSON.stringify(logic.residentSubmission([{id:'id1'},{id:'id2'},{first_name:'חדש'}],3)),JSON.stringify({residents:[{id:'id1'},{id:'id2'},{first_name:'חדש'}],deactivateResidentIds:[]}));
});
test('card sends the paired resident submission payload and the RPC remains explicitly protective',()=>{
  const card=fs.readFileSync(path.join(root,'app/mobile/search/search-unit-card.tsx'),'utf8');
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261004150000_fix_search_unit_card_event_log_guard.sql'),'utf8');
  assert.match(card,/residentSubmission\(residents, known\)/);
  assert.match(card,/name="residents" value=\{JSON\.stringify\(visible\)\}/);
  assert.match(card,/name="deactivateResidentIds" value=\{JSON\.stringify\(submission\.deactivateResidentIds\)\}/);
  assert.match(sql,/v_active_count > p_known_people_count then raise exception 'Reduce residents explicitly before reducing the known people count'/);
  assert.doesNotMatch(sql,/delete from public\.unit_residents/i);
});
test('open and resolved casualty unit semantics use only status and treatment completion',()=>{
  const source=fs.readFileSync(path.join(root,'lib/search-site-status.ts'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const statusModule={exports:{}};
  vm.runInNewContext(compiled,{module:statusModule,exports:statusModule.exports,Set});
  const statusLogic=statusModule.exports;
  assert.equal(statusLogic.isOpenSearchCasualtyUnit('casualties',false),true);
  assert.equal(statusLogic.isOpenSearchCasualtyUnit('casualties',true),false);
  assert.equal(statusLogic.isResolvedSearchCasualtyUnit('completed',true),true);
  assert.equal(statusLogic.isResolvedSearchCasualtyUnit('casualties',true),true);
  assert.equal(statusLogic.isOpenSearchCasualtyUnit('clear',false),false);
  assert.equal(statusLogic.isOpenSearchCasualtyUnit('no_answer',false),false);
});
test('five open casualty apartments include the zero-counter unit six',()=>{
  const source=fs.readFileSync(path.join(root,'lib/search-site-status.ts'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const statusModule={exports:{}};
  vm.runInNewContext(compiled,{module:statusModule,exports:statusModule.exports,Set});
  const {isOpenSearchCasualtyUnit}=statusModule.exports;
  const units=[
    {unit:4,status:'casualties',resolved:false,anxiety:0,physical:1},
    {unit:6,status:'casualties',resolved:false,anxiety:0,physical:0},
    {unit:8,status:'casualties',resolved:false,anxiety:1,physical:1},
    {unit:11,status:'casualties',resolved:false,anxiety:0,physical:1},
    {unit:12,status:'casualties',resolved:false,anxiety:0,physical:1}
  ];
  assert.equal(units.filter((unit)=>isOpenSearchCasualtyUnit(unit.status,unit.resolved)).length,5);
  assert.equal(units.filter((unit)=>unit.anxiety>0||unit.physical>0).length,4);
});
test('protected, mobile, and commander KPI paths use the shared apartment-treatment helpers',()=>{
  const shared=fs.readFileSync(path.join(root,'lib/search-site-status.ts'),'utf8');
  const protectedSite=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'app/mobile/search/mobile-search-ui.tsx'),'utf8');
  const widget=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/search-sites-dashboard-widget.tsx'),'utf8');
  const route=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/search-sites-widget-data/route.ts'),'utf8');
  assert.match(shared,/status === "casualties" && !casualtiesResolved/);
  assert.match(shared,/return Boolean\(casualtiesResolved\)/);
  for(const source of [protectedSite,mobile,widget]) {
    assert.match(source,/isOpenSearchCasualtyUnit/);
    assert.match(source,/isResolvedSearchCasualtyUnit/);
  }
  assert.match(protectedSite,/casualties: searchEntries\.filter\(\(entry\) => isOpenSearchCasualtyUnit\(entry\.status, entry\.casualtiesResolved\)\)/);
  assert.match(widget,/searchOperationalKpiCollections\(site\.entries, site\.casualtyPeople\)/);
  assert.match(widget,/entries=\{kpis\.findings\.openCasualties\}/);
  assert.match(route,/search_status,casualty_psych,casualty_body,medical_evacuation/);
  assert.match(route,/casualties_resolved/);
  assert.match(protectedSite,/SearchOperationalKpis/);
  assert.match(mobile,/דירות עם נפגעים פתוחים/);
});
test('resident status reload decodes the Supabase many-to-one embedded object',()=>{
  for(const statusKey of ['not_checked','resident_clear','anxiety_casualty','physical_casualty','deceased']) {
    assert.equal(logic.residentStatusKeyFromEmbeddedStatus({status_key:statusKey}),statusKey);
  }
  assert.equal(logic.residentStatusKeyFromEmbeddedStatus(null),'not_checked');
  assert.equal(logic.residentStatusKeyFromEmbeddedStatus({}),'not_checked');
  assert.equal(logic.residentStatusKeyFromEmbeddedStatus({status_key:'missing'}),'not_checked');
  assert.equal(logic.residentStatusKeyFromEmbeddedStatus([{status_key:'deceased'}]),'not_checked');
});
test('both resident-loading paths use the shared many-to-one status decoder',()=>{
  const mobilePage=fs.readFileSync(path.join(root,'app/mobile/search/[incidentId]/[siteId]/page.tsx'),'utf8');
  const protectedPage=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx'),'utf8');
  for(const source of [mobilePage,protectedPage]) {
    assert.match(source,/residentStatusKeyFromEmbeddedStatus\(row\.status_types\)/);
    assert.doesNotMatch(source,/status_types\[0\]/);
  }
});
test('casualty person detail includes only active operational casualty residents',()=>{
  const source=fs.readFileSync(path.join(root,'lib/search-casualty-person.ts'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const detailModule={exports:{}};
  vm.runInNewContext(compiled,{module:detailModule,exports:detailModule.exports,Set});
  const detail=detailModule.exports;
  for(const status of ['anxiety_casualty','physical_casualty','deceased']) assert.equal(detail.isActiveSearchCasualtyPerson({isActive:true,status}),true);
  for(const status of ['resident_clear','not_checked','missing']) assert.equal(detail.isActiveSearchCasualtyPerson({isActive:true,status}),false);
  assert.equal(detail.isActiveSearchCasualtyPerson({isActive:false,status:'deceased'}),false);
  const people=[
    {status:'anxiety_casualty',requiresEvacuation:false},
    {status:'physical_casualty',requiresEvacuation:true},
    {status:'deceased',requiresEvacuation:false}
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(detail.searchCasualtyPersonCounts(people))),{anxiety:1,physical:1,deceased:1});
  assert.equal(detail.searchCasualtyPersonStatusLabel('deceased'),'חלל');
  assert.equal(detail.searchCasualtyPersonTreatmentLabel(false),'טיפול פתוח');
  assert.equal(detail.searchCasualtyPersonTreatmentLabel(true),'הטיפול הסתיים');
  const shimon={residentId:'resident-6',unitId:'unit-6',floorNumber:2,unitNumber:'6',firstName:'שמעון',lastName:'פרס',status:'deceased',requiresEvacuation:false,casualtiesResolved:false};
  assert.equal(detail.isActiveSearchCasualtyPerson({isActive:true,status:shimon.status}),true);
  assert.equal(detail.searchCasualtyPersonStatusLabel(shimon.status),'חלל');
  assert.equal(detail.searchCasualtyPersonTreatmentLabel(shimon.casualtiesResolved),'טיפול פתוח');
});
test('casualty person detail uses active resident rows and the existing commander endpoint',()=>{
  const shared=fs.readFileSync(path.join(root,'lib/search-casualty-person.ts'),'utf8');
  const protectedSite=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/sites/[siteId]/page.tsx'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'app/mobile/search/mobile-search-ui.tsx'),'utf8');
  const route=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/search-sites-widget-data/route.ts'),'utf8');
  const widget=fs.readFileSync(path.join(root,'app/(protected)/incidents/[incidentId]/search-sites-dashboard-widget.tsx'),'utf8');
  assert.match(shared,/"anxiety_casualty", "physical_casualty", "deceased"/);
  for(const source of [protectedSite,mobile,route]) assert.match(source,/isActiveSearchCasualtyPerson/);
  assert.match(route,/\.eq\("is_active", true\)/);
  assert.doesNotMatch(route,/\.in\("status_types\.status_key", \["anxiety_casualty", "physical_casualty", "deceased"\]\)/);
  assert.match(route,/isSearchCasualtyPersonStatus\(status\)/);
  assert.match(route,/casualtyPeople: casualtyPeopleBySite\.get\(site\.id\) \?\? \[\]/);
  assert.match(widget,/SearchOperationalKpis/);
  assert.match(protectedSite,/SearchOperationalKpis units=\{searchEntries\} people=\{casualtyPeople\}/);
  assert.match(mobile,/SearchOperationalKpis units=\{operationalUnits\} people=\{casualtyPeople\}/);
  assert.match(route,/casualtiesResolved: Boolean\(result\?\.casualties_resolved\)/);
});

test('complete-casualties confirmation closes only after a successful save state',()=>{
  const card=fs.readFileSync(path.join(root,'app/mobile/search/search-unit-card.tsx'),'utf8');
  assert.match(card,/const \[confirm, setConfirm\] = useState\(false\)/);
  assert.match(card,/onClick=\{\(\)=>setConfirm\(true\)\}/);
  assert.match(card,/onClick=\{\(\)=>setConfirm\(false\)\}/);
  assert.match(card,/if \(!saveState\.saved \|\| saveState\.refreshVersion <= lastRefreshedVersion\.current\) return;[\s\S]*?setConfirm\(false\);[\s\S]*?router\.refresh\(\)/);
});
