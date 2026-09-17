"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import * as actions from "./actions";
import { actionLabels, allowedActions, canAssign, createSubmissionGate, duration, emptyFilters, equipmentTiming,
  equipmentWarning, estimateServerTime, filterEquipment, groupEquipment, operationLabels, REFUEL_CONFIRMATION,
  teamLabel, timeLabels, type Equipment, type EquipmentAction, type EquipmentData, type Filters, type Team } from "./equipment-model";
import styles from "./equipment.module.css";

const mutations = { assign: actions.assignEquipment, update: actions.updateEquipmentAssignment, transfer: actions.transferEquipment,
  release: actions.releaseEquipment, start: actions.startEquipment, pause: actions.pauseEquipment, resume: actions.resumeEquipment, refuel: actions.confirmEquipmentRefuel };
type Run = (action: EquipmentAction, form: FormData, row?: Equipment) => Promise<boolean>;

function TeamSelect({ teams, selected = "" }: { teams: Team[]; selected?: string }) {
  return <label>צוות יעד<select className="input" name="team" required defaultValue={selected}>
    <option value="">בחירת צוות</option>
    {teams.map((team) => <option key={team.key} value={team.key}>{team.label}</option>)}
  </select></label>;
}
function LocationFields({ row }: { row?: Equipment }) {
  return <><label>מיקום<input className="input" name="location" maxLength={500} defaultValue={row?.location ?? ""} /></label>
    <label>הערות<textarea className="input" name="notes" maxLength={5000} defaultValue={row?.notes ?? ""} /></label></>;
}

export function EquipmentClock({ row, serverTime }: { row: Equipment; serverTime: number | null }) {
  const timing = serverTime === null ? null : equipmentTiming(row, serverTime);
  return <div className={`${styles.clock} ${timing ? styles[timing.state] : styles.neutral}`}>
    <span>זמן שנותר</span>
    <strong dir="ltr" className={styles.digits}>{timing ? duration(timing.remaining) : "--:--:--"}</strong>
    <span>{timing ? timeLabels[timing.state] : "מסתנכרן עם זמן השרת…"}</span>
    <progress max={100} value={timing?.progress ?? 0} aria-label="זמן עבודה שנוצל" />
    <div className={styles.clockDetails}>
      <span>זמן מלא: <bdi dir="ltr">{duration(row.full_runtime_seconds_snapshot)}</bdi></span>
      <span>זמן פעילות: <bdi dir="ltr">{timing ? duration(timing.elapsed) : "--:--:--"}</bdi></span>
      <span>סף התרעה: <bdi dir="ltr">{duration(row.warning_before_seconds_snapshot)}</bdi></span>
    </div>
  </div>;
}

export function EquipmentCard({ row, data, serverTime, disabled, run }: {
  row: Equipment; data: EquipmentData; serverTime: number | null; disabled: boolean; run: Run;
}) {
  const [editing, setEditing] = useState<"update" | "transfer" | null>(null);
  const permitted = allowedActions(row, data.incident, data.canEdit);
  const warning = equipmentWarning(row);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing && await run(editing, new FormData(event.currentTarget), row)) setEditing(null);
  }
  return <article className={styles.card} aria-label={`ציוד ${row.asset_identifier_snapshot}`}>
    <div className={styles.heading}><div><h3>{row.asset_identifier_snapshot}</h3><p>{row.equipment_type_name_snapshot}</p></div>
      <span className={`status-pill ${row.operation_state === "running" ? "success" : "neutral"}`}>{operationLabels[row.operation_state]}</span></div>
    {warning && <p className={styles.warning} role="note">{warning}</p>}
    <dl className={styles.details}>
      <div><dt>מספר סידורי</dt><dd><bdi>{row.serial_number || "לא צוין"}</bdi></dd></div>
      <div><dt>צוות</dt><dd>{teamLabel(row)}</dd></div>
      <div><dt>מיקום</dt><dd>{row.location || "לא צוין"}</dd></div>
      <div><dt>הערות</dt><dd className={styles.notes}>{row.notes || "אין הערות"}</dd></div>
      <div><dt>כשירות נוכחית</dt><dd>{row.serviceability === "serviceable" ? "כשיר" : row.serviceability === "restricted" ? "כשירות מוגבלת" : "לא כשיר"}</dd></div>
    </dl>
    <EquipmentClock row={row} serverTime={serverTime} />
    <details><summary>פרטי פעילות והוראות</summary>
      <p className={styles.notes}>{row.instructions_snapshot || "אין הוראות נוספות"}</p>
      <p>פעילות שנצברה לפני המקטע הנוכחי: <bdi dir="ltr">{duration(Number(row.accumulated_active_seconds))}</bdi></p>
      <p>תחילת מקטע הפעלה: {row.running_since ? <bdi dir="ltr">{new Date(row.running_since).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</bdi> : "אין מקטע פועל"}</p>
      <p>גרסת הקצאה: {row.version}</p>
    </details>
    {permitted.length > 0 && <div className={styles.actions}>
      {permitted.map((action) => <button type="button" key={action} className="button secondary" disabled={disabled}
        onClick={() => action === "update" || action === "transfer" ? setEditing(action) : void run(action, new FormData(), row)}>
        {action === "update" ? "ערוך מיקום והערות" : actionLabels[action]}</button>)}
    </div>}
    {editing && permitted.includes(editing) && <form onSubmit={save} className={styles.editor}>
      <h4>{editing === "update" ? "עריכת ההקצאה" : "העברת ציוד לצוות"}</h4>
      <fieldset disabled={disabled} className={styles.fields}>
        {editing === "update" ? <LocationFields row={row} /> : <TeamSelect teams={data.teams} />}
        <div className={styles.actions}><button className="button" type="submit">{actionLabels[editing]}</button>
          <button className="button secondary" type="button" onClick={() => setEditing(null)}>ביטול</button></div>
      </fieldset>
    </form>}
  </article>;
}

export function EquipmentScreen({ incidentId, initial, initialError }: { incidentId: string; initial: EquipmentData | null; initialError: string | null }) {
  const [data, setData] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(initialError ? { ok: false, text: initialError } : null);
  const [readError, setReadError] = useState<string | null>(initialError);
  const [serverTime, setServerTime] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const gate = useRef(createSubmissionGate());
  const anchor = useRef<{ serverNow: string; receivedAt: number } | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const result = await actions.readEquipment(incidentId);
      if (sequence !== refreshSequence.current) return false;
      if (result.ok === false) { setReadError(result.message); setReady(false); return false; }
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
    if (await run("assign", new FormData(event.currentTarget))) setAssigning(false);
  }
  function filter(key: keyof Filters, value: string) { setFilters((current) => ({ ...current, [key]: value })); }
  const rows = data?.equipment ?? [];
  const visible = filterEquipment(rows, filters, serverTime);
  // Keep cards mounted when a time filter changes on a tick, preserving drafts.
  const groups = groupEquipment(rows);
  const visibleIds = new Set(visible.map((row) => row.assignment_id));
  const teamOptions = groupEquipment(rows);
  const types = Array.from(new Map(rows.map((row) => [row.equipment_type_id_snapshot, row.equipment_type_name_snapshot])).entries());
  const timed = serverTime === null ? null : rows.map((row) => equipmentTiming(row, serverTime));
  const summary = [ ["ציוד מוקצה", rows.length], ["פועל", rows.filter((row) => row.operation_state === "running").length],
    ["מושהה", rows.filter((row) => row.operation_state === "paused").length], ["כבוי", rows.filter((row) => row.operation_state === "off").length],
    ["בטווח התרעה", timed ? timed.filter((row) => row.state === "warning").length : "—"], ["בחריגה", timed ? timed.filter((row) => row.state === "overdue").length : "—"] ];
  return <main className={`page ${styles.screen}`} dir="rtl" aria-busy={busy}>
    <header className={styles.heading}><div><p className="eyebrow">ציוד תפעולי באירוע</p><h1>ניהול ציוד</h1><p className="muted">{data?.incident.name}</p></div>
      <button type="button" className="button secondary" disabled={busy} onClick={() => void refresh()}>רענן נתונים</button></header>
    {message && <p className={message.ok ? styles.success : styles.error} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    {readError && <p className={styles.error} role="alert">{readError} פעולות הציוד חסומות עד לרענון מוצלח.</p>}
    {busy && <p role="status">מבצע פעולה ומרענן נתונים…</p>}
    {!ready && !readError && <p role="status">טוען מצב עדכני וזמן שרת…</p>}
    {data && <>
      <dl className={styles.summary}>{summary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="muted">הסיכומים מתייחסים לכל הציוד המוקצה. התצוגה מתקדמת מקומית; רענון קורא מצב עדכני מהשרת.</p>
      {data.incident.archived_at || data.incident.is_closed || data.incident.lifecycle_status === "closed"
        ? <p className={styles.notice}>האירוע סגור או מאורכב. הציוד מוצג לקריאה בלבד.</p>
        : data.incident.lifecycle_status === "paused" ? <p className={styles.notice}>האירוע מושהה. ניתן לתפעל ציוד שכבר הוקצה; הקצאה חדשה אינה זמינה.</p>
        : !data.canEdit ? <p className={styles.notice}>הרשאת צפייה בלבד.</p> : null}
      {canAssign(data.incident, data.canEdit) && <section className="panel">
        <div className={styles.heading}><div><h2>הקצאת ציוד מהקטלוג</h2><p>בחרו פריט פנוי וצוות אחד. ההקצאה מתחילה כבויה, לאחר השמשה מלאה במחסני היחידה.</p></div>
          <button className="button" type="button" disabled={busy || !ready || !!data.availabilityError} onClick={() => setAssigning(!assigning)}>{assigning ? "סגור טופס" : "הקצה ציוד"}</button></div>
        {data.availabilityError && <p className={styles.error} role="alert">{data.availabilityError}</p>}
        {assigning && <form onSubmit={assign} className={styles.editor}><fieldset className={styles.fields} disabled={busy || !ready || !!data.availabilityError}>
          <label>פריט פנוי<select name="equipmentItemId" className="input" required defaultValue=""><option value="">בחירת ציוד</option>
            {data.available.map((item) => <option key={item.equipment_item_id} value={item.equipment_item_id}>{item.asset_identifier} · {item.equipment_type_name}{item.serial_number ? ` · ${item.serial_number}` : ""} · זמן מלא {duration(item.full_runtime_seconds)}</option>)}</select></label>
          <TeamSelect teams={data.teams} /><LocationFields />
          {!data.available.length && <p>אין כעת ציוד פנוי, פעיל וכשיר להקצאה.</p>}
          {!data.teams.length && <p>אין צוות פעיל באירוע. יש להוסיף צוות לפני הקצאה.</p>}
          <button className="button" type="submit" disabled={!data.available.length || !data.teams.length}>אישור הקצאה</button>
        </fieldset></form>}
      </section>}
      <section className={styles.filters} aria-label="חיפוש וסינון ציוד">
        <label>חיפוש<input className="input" type="search" value={filters.query} placeholder="כינוי או מספר סידורי" onChange={(e) => filter("query", e.target.value)} /></label>
        <label>צוות<select className="input" value={filters.team} onChange={(e) => filter("team", e.target.value)}><option value="">כל הצוותים</option>{teamOptions.map((team) => <option key={team.key} value={team.key}>{team.label}</option>)}</select></label>
        <label>סוג ציוד<select className="input" value={filters.type} onChange={(e) => filter("type", e.target.value)}><option value="">כל הסוגים</option>{types.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>מצב הפעלה<select className="input" value={filters.operation} onChange={(e) => filter("operation", e.target.value)}><option value="">כל המצבים</option>{Object.entries(operationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>מצב זמן<select className="input" value={filters.time} onChange={(e) => filter("time", e.target.value)}><option value="">כל הזמנים</option>{Object.entries(timeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button type="button" className="button secondary" onClick={() => setFilters(emptyFilters)}>נקה סינון</button>
      </section>
      <p className="muted">מוצגים {visible.length} מתוך {rows.length} פריטים</p>
      {!rows.length && <section className="panel"><h2>אין ציוד מוקצה באירוע</h2><p>לא נמצאו הקצאות פתוחות. ציוד ששוחרר נשמר ביומן האירוע.</p></section>}
      {rows.length > 0 && !visible.length && <p className="panel">לא נמצא ציוד התואם לסינון.</p>}
      {groups.map((group) => <section key={group.key} className={styles.group} hidden={!group.rows.some((row) => visibleIds.has(row.assignment_id))}>
          <h2>{group.label} <span className="status-pill neutral">{group.rows.filter((row) => visibleIds.has(row.assignment_id)).length}</span></h2><div className={styles.cards}>
            {group.rows.map((row) => <div key={row.assignment_id} hidden={!visibleIds.has(row.assignment_id)}>
              <EquipmentCard row={row} data={data} serverTime={serverTime} disabled={busy || !ready} run={run} />
            </div>)}
          </div></section>)}
    </>}
  </main>;
}
