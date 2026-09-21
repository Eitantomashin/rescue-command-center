"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import * as actions from "./actions";
import { actionLabels, allowedActions, canAssign, createSubmissionGate, duration, emptyFilters, equipmentTiming,
  equipmentWarning, estimateServerTime, filterEquipment, groupEquipment, operationLabels, REFUEL_CONFIRMATION,
  teamLabel, timeLabels, type AvailableEquipment, type Equipment, type EquipmentAction, type EquipmentData, type Filters, type Team } from "./equipment-model";
import styles from "./equipment.module.css";
import { useEquipmentRevision } from "./equipment-refresh-context";
import { controlState, createEquipmentOrdering, matchesFocus, primaryAction, readViewMode, saveViewMode, summaryFilters,
  teamOptionsByCategory, type FocusFilter, type SortMode, type ViewMode } from "./equipment-presentation";
import { EquipmentIcon, EquipmentTime, FuelGauge } from "./equipment-indicators";

const mutations = { assign: actions.assignEquipment, update: actions.updateEquipmentAssignment, transfer: actions.transferEquipment,
  release: actions.releaseEquipment, start: actions.startEquipment, pause: actions.pauseEquipment, resume: actions.resumeEquipment, refuel: actions.confirmEquipmentRefuel };
type Run = (action: EquipmentAction, form: FormData, row?: Equipment) => Promise<boolean>;

export function TeamSelect({ teams, selected = "" }: { teams: Team[]; selected?: string }) {
  const [value, setValue] = useState(selected);
  return <label>צוות יעד<select className="input" name="team" required value={value} onChange={(event) => setValue(event.target.value)}>
    <option value="">בחירת צוות</option>
    {value && !teams.some((team) => team.key === value) && <option value={value}>הצוות שנבחר אינו זמין עוד</option>}
    {teamOptionsByCategory(teams).map((group) => <optgroup key={group.label} label={group.label}>
      {group.options.map((team) => <option key={team.key} value={team.key}>{team.label}</option>)}
    </optgroup>)}
  </select></label>;
}
function LocationFields({ row }: { row?: Equipment }) {
  return <><label>מיקום<input className="input" name="location" maxLength={500} defaultValue={row?.location ?? ""} /></label>
    <label>הערות<textarea className="input" name="notes" maxLength={5000} defaultValue={row?.notes ?? ""} /></label></>;
}

export function EquipmentClock({ row, serverTime }: { row: Equipment; serverTime: number | null }) {
  const timing = serverTime === null ? null : equipmentTiming(row, serverTime);
  const control = controlState(row, serverTime);
  return <div className={`${styles.clock} ${styles[control.tone]}`}>
    <span>זמן שנותר</span>
    <strong dir="ltr" className={styles.digits}>{timing ? duration(timing.remaining) : "--:--:--"}</strong>
    <span>{timing ? `${timing.remaining < 0 ? "חריגה — " : ""}${control.label}${row.operation_state === "paused" ? " · מושהה" : ""}` : "מסתנכרן עם זמן השרת…"}</span>
    <FuelGauge row={row} serverTime={serverTime} />
    <div className={styles.clockDetails}>
      <span>זמן מלא: <bdi dir="ltr">{duration(row.full_runtime_seconds_snapshot)}</bdi></span>
      <span>זמן פעילות: <bdi dir="ltr">{timing ? duration(timing.elapsed) : "--:--:--"}</bdi></span>
      <span>סף התרעה: <bdi dir="ltr">{duration(row.warning_before_seconds_snapshot)}</bdi></span>
    </div>
  </div>;
}

export function EquipmentCard({ row, data, serverTime, disabled, run, unavailable = false, onEditing, mode = "detailed", focused = false }: {
  row: Equipment; data: EquipmentData; serverTime: number | null; disabled: boolean; run: Run;
  unavailable?: boolean; onEditing?: (row: Equipment, editing: boolean) => void;
  mode?: ViewMode; focused?: boolean;
}) {
  const [editing, setEditing] = useState<"update" | "transfer" | null>(null);
  const [draftRow, setDraftRow] = useState<Equipment | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (focused) setExpanded(true); }, [focused]);
  const permitted = unavailable ? [] : allowedActions(row, data.incident, data.canEdit);
  const stale = !!draftRow && draftRow.version !== row.version;
  const warning = equipmentWarning(row);
  const isExpanded = mode === "detailed" || expanded || !!editing;
  const mainAction = primaryAction(row);
  function finishEditing() { setEditing(null); setDraftRow(null); onEditing?.(row, false); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing && !stale && !unavailable && permitted.includes(editing)
      && await run(editing, new FormData(event.currentTarget), draftRow ?? row)) finishEditing();
  }
  return <article className={`${styles.card} ${mode === "compact" ? styles.compactCard : ""}`} aria-label={`ציוד ${row.asset_identifier_snapshot}`}>
    <div className={styles.compactRow}>
      <div className={styles.assetTitle}><EquipmentIcon /><div><h3>{row.asset_identifier_snapshot}</h3>
        {row.serial_number && <small>מס׳ סידורי: <bdi>{row.serial_number}</bdi></small>}</div></div>
      <span className={`status-pill ${row.operation_state === "running" ? "success" : "neutral"}`}>{operationLabels[row.operation_state]}</span>
      {!unavailable && <EquipmentTime row={row} serverTime={serverTime} />}
      <div className={styles.actions}>
        {mode === "compact" && permitted.includes(mainAction) && <button className="button" type="button" disabled={disabled}
          onClick={() => void run(mainAction, new FormData(), row)}>{mainAction === "resume" ? "המשך" : actionLabels[mainAction]}</button>}
        {mode === "compact" && <button className="button secondary" type="button" aria-expanded={isExpanded}
          aria-controls={`details-${row.assignment_id}`} onClick={() => setExpanded(!isExpanded)} disabled={!!editing}>{isExpanded ? "צמצם" : "פרטים"}</button>}
      </div>
    </div>
    {warning && <p className={styles.warning} role="note">{warning}</p>}
    {unavailable && <p className={styles.warning}>ההקצאה הסתיימה במכשיר אחר. הטיוטה נשמרה לעיון, אך לא ניתן לשלוח אותה.</p>}
    <div id={`details-${row.assignment_id}`} hidden={!isExpanded} className={styles.expandedContent}>
    <dl className={styles.details}>
      <div><dt>סוג ציוד</dt><dd>{row.equipment_type_name_snapshot}</dd></div>
      <div><dt>מספר סידורי</dt><dd><bdi>{row.serial_number || "לא צוין"}</bdi></dd></div>
      <div><dt>צוות</dt><dd>{teamLabel(row)}</dd></div>
      <div><dt>מיקום</dt><dd>{row.location || "לא צוין"}</dd></div>
      <div><dt>הערות</dt><dd className={styles.notes}>{row.notes || "אין הערות"}</dd></div>
      <div><dt>כשירות נוכחית</dt><dd>{row.serviceability === "serviceable" ? "כשיר" : row.serviceability === "restricted" ? "כשירות מוגבלת" : "לא כשיר"}</dd></div>
    </dl>
    {!unavailable && <EquipmentClock row={row} serverTime={serverTime} />}
    <details><summary>פרטי פעילות והוראות</summary>
      <p className={styles.notes}>{row.instructions_snapshot || "אין הוראות נוספות"}</p>
      <p>פעילות שנצברה לפני המקטע הנוכחי: <bdi dir="ltr">{duration(Number(row.accumulated_active_seconds))}</bdi></p>
      <p>תחילת מקטע הפעלה: {row.running_since ? <bdi dir="ltr">{new Date(row.running_since).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</bdi> : "אין מקטע פועל"}</p>
      <p>גרסת הקצאה: {row.version}</p>
    </details>
    {permitted.length > 0 && <div className={styles.actions}>
      {permitted.filter((action) => mode !== "compact" || action !== mainAction).map((action) => <button type="button" key={action} className="button secondary" disabled={disabled}
        onClick={() => { if (action === "update" || action === "transfer") { setDraftRow(row); setEditing(action); onEditing?.(row, true); }
          else void run(action, new FormData(), row); }}>
        {action === "update" ? "ערוך מיקום והערות" : actionLabels[action]}</button>)}
    </div>}
    {editing && <form onSubmit={save} className={styles.editor}>
      <h4>{editing === "update" ? "עריכת ההקצאה" : "העברת ציוד לצוות"}</h4>
      {stale && <p className={styles.warning} role="status">ההקצאה השתנתה במכשיר אחר. הקלט שלך נשמר. יש לטעון את הערכים החדשים לפני שמירה.
        <button className="button secondary" type="button" disabled={disabled || unavailable} onClick={() => setDraftRow(row)}>טען ערכים חדשים</button></p>}
      <fieldset disabled={disabled || unavailable || !permitted.includes(editing)} className={styles.fields}>
        <div key={`${editing}:${draftRow?.version}`} className={styles.fields}>
          {editing === "update" ? <LocationFields row={draftRow ?? row} /> : <TeamSelect teams={data.teams} />}
        </div>
        <button className="button" type="submit" disabled={stale}>{actionLabels[editing]}</button>
      </fieldset>
      <button className="button secondary" type="button" onClick={finishEditing}>סגור טיוטה</button>
    </form>}
    </div>
  </article>;
}

export function EquipmentScreen({ incidentId, initial, initialError, targetAssignment = null }: { incidentId: string; initial: EquipmentData | null; initialError: string | null; targetAssignment?: string | null }) {
  const [data, setData] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(initialError ? { ok: false, text: initialError } : null);
  const [readError, setReadError] = useState<string | null>(initialError);
  const [serverTime, setServerTime] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AvailableEquipment | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [openEditors, setOpenEditors] = useState<Record<string, Equipment>>({});
  const [mode, setMode] = useState<ViewMode>("compact");
  const [sort, setSort] = useState<SortMode>("exceptions");
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const groupDefaults = useRef<Record<string, boolean>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const visitedTarget = useRef<string | null>(null);
  const ordering = useRef(createEquipmentOrdering());
  const revision = useEquipmentRevision();
  const gate = useRef(createSubmissionGate());
  const anchor = useRef<{ serverNow: string; receivedAt: number } | null>(null);
  const refreshSequence = useRef(0);
  useEffect(() => { try { setMode(readViewMode(window.localStorage)); } catch { /* Storage unavailable. */ } }, []);
  function chooseMode(value: ViewMode) { setMode(value); try { saveViewMode(window.localStorage, value); } catch { /* Optional. */ } }
  useEffect(() => {
    if (!ready || !targetAssignment || visitedTarget.current === targetAssignment) return;
    visitedTarget.current = targetAssignment;
    const target = data?.equipment.find((row) => row.assignment_id === targetAssignment);
    if (!target) { setDeepLinkNotice("הציוד המבוקש אינו בהקצאות הפתוחות של האירוע. ייתכן שכבר שוחרר."); return; }
    setDeepLinkNotice(null); setFilters(emptyFilters); setFocusFilter("all");
    const group = groupEquipment([target])[0];
    setOpenGroups((current) => ({ ...current, [group.key]: true })); setHighlight(targetAssignment);
  }, [ready, targetAssignment, data]);
  useEffect(() => {
    if (!highlight) return;
    const element = document.getElementById(`equipment-${highlight}`);
    element?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    element?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setHighlight(null), 5000);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const result = await actions.readEquipment(incidentId);
      if (sequence !== refreshSequence.current) return false;
      if (result.ok === false) { setReadError(result.message); setReady(false); if (result.denied) setData(null); return false; }
      // Anchor on receipt, never on SSR rendering or the browser wall clock.
      anchor.current = { serverNow: result.data.server_now, receivedAt: performance.now() };
      setServerTime(Date.parse(result.data.server_now));
      setData(result.data); setReadError(null); setReady(true);
      return true;
    } catch {
      if (sequence === refreshSequence.current) { setReadError("רענון הציוד נכשל. יש לבדוק את החיבור ולנסות שוב."); setReady(false); }
      return false;
    }
  }, [incidentId]);

  useEffect(() => { if (revision > 0) void refresh(); }, [revision, refresh]);

  useEffect(() => {
    // Same null clock placeholder on server and first browser render. Obtain a
    // fresh sample after hydration; the SSR payload may have waited in transit.
    void refresh();
    const resync = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    const timer = window.setInterval(() => {
      if (anchor.current) setServerTime(estimateServerTime(anchor.current.serverNow, anchor.current.receivedAt, performance.now()));
    }, 1000);
    return () => { ++refreshSequence.current; window.clearInterval(timer); document.removeEventListener("visibilitychange", resync); window.removeEventListener("focus", resync); };
  }, [refresh]);

  const run: Run = async (action, form, row) => {
    if (!ready || !gate.current.enter()) return false;
    setBusy(true);
    try {
      if (action === "refuel" && !window.confirm(REFUEL_CONFIRMATION)) return false;
      if (action === "release" && !window.confirm("האם לשחרר את הציוד ולהחזירו למחסני היחידה?")) return false;
      form.set("incidentId", incidentId);
      form.set("requestId", crypto.randomUUID());
      if (row) { form.set("assignmentId", row.assignment_id); form.set("version", String(row.version)); }
      const result = await mutations[action](form);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok || result.refresh) {
        const fresh = await refresh();
        if (!fresh) return false; // Keep forms/cards until the server confirms the new view.
      }
      return result.ok;
    } catch {
      setMessage({ ok: false, text: "לא התקבל אישור פעולה. יש לרענן ולבדוק את המצב לפני ניסיון נוסף." });
      await refresh();
      return false;
    } finally { gate.current.leave(); setBusy(false); }
  };
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run("assign", new FormData(event.currentTarget))) { setAssigning(false); setSelectedItem(null); }
  }
  function filter(key: keyof Filters, value: string) { setFilters((current) => ({ ...current, [key]: value })); }
  const rows = data?.equipment ?? [];
  const retained = Object.values(openEditors).filter((row) => !rows.some((current) => current.assignment_id === row.assignment_id));
  const displayRows = rows.concat(retained);
  const visible = filterEquipment(displayRows, filters, serverTime).filter((row) => matchesFocus(row, serverTime, focusFilter));
  // Keep cards mounted when a time filter changes on a tick, preserving drafts.
  const groups = ordering.current(displayRows, serverTime, sort, data?.server_now ?? "");
  const visibleIds = new Set(visible.map((row) => row.assignment_id));
  const teamOptions = groupEquipment(rows);
  const types = Array.from(new Map(rows.map((row) => [row.equipment_type_id_snapshot, row.equipment_type_name_snapshot])).entries());
  return <main className={`page ${styles.screen}`} dir="rtl" aria-busy={busy}>
    <header className={styles.heading}><div><p className="eyebrow">ציוד תפעולי באירוע</p><h1>ניהול ציוד</h1><p className="muted">{data?.incident.name}</p></div>
      <button type="button" className="button secondary" disabled={busy} onClick={() => void refresh()}>רענן נתונים</button></header>
    {message && <p className={message.ok ? styles.success : styles.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    {readError && <p className={styles.error} role="alert">{readError} פעולות הציוד חסומות עד לרענון מוצלח.</p>}
    {busy && <p role="status">מבצע פעולה ומרענן נתונים…</p>}
    {!ready && !readError && <p role="status">טוען מצב עדכני וזמן שרת…</p>}
    {deepLinkNotice && <p className={styles.notice} role="status">{deepLinkNotice}</p>}
    {data && <>
      <div className={styles.summary} aria-label="סיכום מבצעי">{summaryFilters.map(({ key, label }) => {
        const count = rows.filter((row) => matchesFocus(row, serverTime, key)).length;
        return <button type="button" key={key} aria-pressed={focusFilter === key}
          className={count && ["warning", "overdue", "serviceability"].includes(key) ? styles.attention : ""}
          onClick={() => { setFilters(emptyFilters); setFocusFilter(focusFilter === key ? "all" : key); }}>
          <span>{label}</span><strong>{serverTime === null && ["warning", "overdue"].includes(key) ? "—" : count}</strong>
        </button>;
      })}</div>
      <p className="muted">הסיכומים מתייחסים לכל הציוד המוקצה. התצוגה מתקדמת מקומית; רענון קורא מצב עדכני מהשרת.</p>
      {data.incident.archived_at || data.incident.is_closed || data.incident.lifecycle_status === "closed"
        ? <p className={styles.notice}>האירוע סגור או מאורכב. הציוד מוצג לקריאה בלבד.</p>
        : data.incident.lifecycle_status === "paused" ? <p className={styles.notice}>האירוע מושהה. ניתן לתפעל ציוד שכבר הוקצה; הקצאה חדשה אינה זמינה.</p>
        : !data.canEdit ? <p className={styles.notice}>הרשאת צפייה בלבד.</p> : null}
      <section className={styles.filters} aria-label="חיפוש וסינון ציוד">
        <label>חיפוש<input className="input" type="search" value={filters.query} placeholder="כינוי או מספר סידורי" onChange={(e) => filter("query", e.target.value)} /></label>
        <label>צוות<select className="input" value={filters.team} onChange={(e) => filter("team", e.target.value)}><option value="">כל הצוותים</option>{teamOptions.map((team) => <option key={team.key} value={team.key}>{team.label}</option>)}</select></label>
        <label>סוג ציוד<select className="input" value={filters.type} onChange={(e) => filter("type", e.target.value)}><option value="">כל הסוגים</option>{types.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>מצב הפעלה<select className="input" value={filters.operation} onChange={(e) => filter("operation", e.target.value)}><option value="">כל המצבים</option>{Object.entries(operationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>מצב זמן<select className="input" value={filters.time} onChange={(e) => filter("time", e.target.value)}><option value="">כל הזמנים</option>{Object.entries(timeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button type="button" className="button secondary" onClick={() => { setFilters(emptyFilters); setFocusFilter("all"); }}>נקה סינון</button>
      </section>
      <div className={styles.toolbar}>
        <div className={styles.actions} role="group" aria-label="מצב תצוגה">
          <button type="button" className="button secondary" aria-pressed={mode === "compact"} onClick={() => chooseMode("compact")}>תצוגה מרוכזת</button>
          <button type="button" className="button secondary" aria-pressed={mode === "detailed"} onClick={() => chooseMode("detailed")}>תצוגה מפורטת</button>
        </div>
        <label>מיון<select className="input" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
          <option value="exceptions">חריגים תחילה</option><option value="team">לפי צוות</option>
          <option value="name">לפי שם ציוד</option><option value="remaining">לפי זמן שנותר</option>
        </select></label>
        <button type="button" className="button secondary" aria-pressed={focusFilter === "exceptions"}
          onClick={() => { setFilters(emptyFilters); setFocusFilter(focusFilter === "exceptions" ? "all" : "exceptions"); }}>
          {focusFilter === "exceptions" ? "הצג את כל הציוד" : "הצג חריגים בלבד"}</button>
      </div>
      <p className="muted">מוצגים {visible.filter((row) => rows.some((current) => current.assignment_id === row.assignment_id)).length} מתוך {rows.length} פריטים
        {retained.length > 0 && ` · ${retained.length} טיוטות להקצאות שהסתיימו`}</p>
      {!rows.length && <section className="panel"><h2>אין ציוד מוקצה באירוע</h2><p>לא נמצאו הקצאות פתוחות. ציוד ששוחרר נשמר ביומן האירוע.</p></section>}
      {!visible.length && focusFilter === "exceptions" && <p className="panel">{readError ? "לא ניתן לאשר את מצב הציוד עד לחידוש הסנכרון."
        : rows.some((row) => matchesFocus(row, serverTime, "exceptions")) ? "אין חריגים התואמים לסינון שנבחר." : "כל הציוד במצב תקין"}</p>}
      {rows.length > 0 && !visible.length && focusFilter !== "exceptions" && <p className="panel">לא נמצא ציוד התואם לסינון.</p>}
      <div className={`${styles.cards} ${mode === "compact" ? styles.compactList : ""}`}>{groups.flatMap((group) => {
        const alertCount = group.rows.filter((row) => controlState(row, serverTime).rank < 2).length;
        if (serverTime !== null && !(group.key in groupDefaults.current)) groupDefaults.current[group.key] = rows.length <= 12 || alertCount > 0;
        const opened = openGroups[group.key] ?? groupDefaults.current[group.key] ?? true;
        return [
        <h2 key={`heading:${group.key}`} className={styles.groupHeading} hidden={!group.rows.some((row) => visibleIds.has(row.assignment_id))}>
          <button type="button" aria-expanded={opened} onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !opened }))}>
            <span>{group.label}</span><small>{group.rows.length} פריטים · {group.rows.filter((row) => row.operation_state === "running").length} פועלים · {alertCount} דורשים תדלוק או בחריגה</small>
            <span>{opened ? "כווץ קבוצה" : "פתח קבוצה"}</span>
          </button>
        </h2>,
        ...group.rows.map((row) => <div key={row.assignment_id} hidden={!opened || !visibleIds.has(row.assignment_id)}
          id={`equipment-${row.assignment_id}`} tabIndex={-1} className={highlight === row.assignment_id ? styles.highlight : undefined}>
          <EquipmentCard row={row} data={data} serverTime={serverTime} disabled={busy || !ready} run={run}
            mode={mode} focused={highlight === row.assignment_id}
            unavailable={!rows.some((current) => current.assignment_id === row.assignment_id)} onEditing={(edited, open) => setOpenEditors((current) => {
              const next = { ...current }; if (open) next[edited.assignment_id] = edited; else delete next[edited.assignment_id]; return next;
            })} />
        </div>)
      ]; })}</div>
      {(canAssign(data.incident, data.canEdit) || assigning) && <section className="panel">
        <div className={styles.heading}><div><h2>הקצאת ציוד מהקטלוג</h2><p>בחרו פריט פנוי וצוות אחד. ההקצאה מתחילה כבויה, לאחר השמשה מלאה במחסני היחידה.</p></div>
          <button className="button" type="button" disabled={busy || !ready || !!data.availabilityError} onClick={() => setAssigning(!assigning)}>{assigning ? "סגור טופס" : "הקצה ציוד"}</button></div>
        {data.availabilityError && <p className={styles.error} role="alert">{data.availabilityError}</p>}
        {assigning && <form onSubmit={assign} className={styles.editor}><fieldset className={styles.fields} disabled={busy || !ready || !!data.availabilityError || !canAssign(data.incident, data.canEdit)}>
          <label>פריט פנוי<select name="equipmentItemId" className="input" required value={selectedItem?.equipment_item_id ?? ""}
            onChange={(event) => setSelectedItem(data.available.find((item) => item.equipment_item_id === event.target.value) ?? null)}><option value="">בחירת ציוד</option>
            {selectedItem && !data.available.some((item) => item.equipment_item_id === selectedItem.equipment_item_id)
              && <option value={selectedItem.equipment_item_id}>{selectedItem.asset_identifier} · אינו זמין עוד להקצאה</option>}
            {data.available.map((item) => <option key={item.equipment_item_id} value={item.equipment_item_id}>{item.asset_identifier} · {item.equipment_type_name}{item.serial_number ? ` · ${item.serial_number}` : ""} · זמן מלא {duration(item.full_runtime_seconds)}</option>)}</select></label>
          <TeamSelect teams={data.teams} /><LocationFields />
          {!data.available.length && <p>אין כעת ציוד פנוי, פעיל וכשיר להקצאה.</p>}
          {!data.teams.length && <p>אין צוות פעיל באירוע. יש להוסיף צוות לפני הקצאה.</p>}
          <button className="button" type="submit" disabled={!data.available.length || !data.teams.length
            || (!!selectedItem && !data.available.some((item) => item.equipment_item_id === selectedItem.equipment_item_id))}>אישור הקצאה</button>
        </fieldset></form>}
      </section>}
    </>}
  </main>;
}
