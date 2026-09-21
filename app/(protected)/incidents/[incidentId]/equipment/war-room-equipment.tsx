"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readEquipment } from "./actions";
import { useEquipmentRevision } from "./equipment-refresh-context";
import { duration, equipmentWarning, estimateServerTime, operationLabels, teamLabel, type EquipmentData } from "./equipment-model";
import { controlState, createEquipmentRowOrdering, defaultEquipmentTab, equipmentHref } from "./equipment-presentation";
import { EquipmentIcon } from "./equipment-indicators";
import styles from "./war-room-equipment.module.css";

export function WarRoomEquipment({ incidentId, initial, children }: { incidentId: string; initial: EquipmentData | null; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [choice, setChoice] = useState<"equipment" | "events" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const revision = useEquipmentRevision();
  const anchor = useRef<{ server: string; mono: number } | null>(null);
  const sequence = useRef(0);
  const ordering = useRef(createEquipmentRowOrdering());
  useEffect(() => {
    let live = true; const request = ++sequence.current;
    void readEquipment(incidentId).then((result) => {
      if (!live || request !== sequence.current) return;
      if (result.ok === false) { setError(result.message); if (result.denied) setData(null); return; }
      anchor.current = { server: result.data.server_now, mono: performance.now() };
      setData(result.data); setNow(Date.parse(result.data.server_now)); setError(null);
    }).catch(() => { if (live) setError("לא ניתן לסנכרן את מצב הציוד כעת."); });
    return () => { live = false; };
  }, [incidentId, revision]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (anchor.current) setNow(estimateServerTime(anchor.current.server, anchor.current.mono, performance.now()));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const rows = data?.equipment ?? [];
  const ordered = ordering.current(rows, now, data?.server_now ?? "");
  // A tab explicitly chosen by the user survives ticks and new snapshots.
  const tab = choice ?? defaultEquipmentTab(rows);
  const alertCount = rows.filter((row) => controlState(row, now).rank < 2).length;
  const items = showAll ? ordered : ordered.slice(0, 5);
  return <section className={`war-room-panel war-room-events-panel top ${styles.panel}`} dir="rtl" aria-label="מצב ציוד ואירועים אחרונים">
    <div role="tablist" aria-label="מידע בחמ״ל" className={styles.tabs}>
      {(["equipment", "events"] as const).map((value) => <button key={value} id={`war-${value}-tab`} type="button" role="tab"
        aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls={`war-${value}-panel`}
        onClick={() => setChoice(value)} onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault(); const next = event.key === "Home" ? "equipment" : event.key === "End" ? "events" : value === "events" ? "equipment" : "events";
            setChoice(next); document.getElementById(`war-${next}-tab`)?.focus();
          }
        }}>{value === "equipment" ? `מצב הציוד${alertCount ? ` · ${alertCount} התרעות` : ""}` : "אירועים אחרונים"}</button>)}
    </div>
    <div id="war-events-panel" role="tabpanel" aria-labelledby="war-events-tab" hidden={tab !== "events"}>{children}</div>
    <div id="war-equipment-panel" role="tabpanel" aria-labelledby="war-equipment-tab" hidden={tab !== "equipment"}>
      {error && <p role="alert" className={styles.error}>{error} הנתונים עשויים להיות לא עדכניים.</p>}
      {!rows.length && <p>אין ציוד מוקצה באירוע.</p>}
      {!!rows.length && <div role="table" aria-label="מצב הציוד" className={styles.table}>
        <div role="row" className={styles.tableHead}>{["ציוד", "צוות", "מועד הפעלה", "סטטוס", "זמן שנותר", "מצב בקרה"].map((label) => <span role="columnheader" key={label}>{label}</span>)}</div>
        {items.map((row) => {
          const state = controlState(row, now); const warning = equipmentWarning(row);
          // running_since is the current segment; first_started_at is explicitly
          // labelled as first activation. There is no last-segment timestamp in this read contract.
          const started = row.running_since ?? row.first_started_at;
          return <div role="row" key={row.assignment_id} className={styles.row}>
            <span role="cell" data-label="ציוד"><Link href={equipmentHref(incidentId, row.assignment_id)} className={styles.rowLink}>
              <EquipmentIcon /><strong>{row.asset_identifier_snapshot}</strong></Link></span>
            <span role="cell" data-label="צוות">{teamLabel(row)}</span>
            <span role="cell" data-label="מועד הפעלה" title={row.running_since ? "תחילת המקטע הנוכחי" : "הפעלה ראשונה במחזור"}>
              {started ? <><bdi>{new Date(started).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</bdi>
                {!row.running_since && <small>הפעלה ראשונה</small>}</> : "טרם הופעל"}</span>
            <span role="cell" data-label="סטטוס">{operationLabels[row.operation_state]}</span>
            <span role="cell" data-label="זמן שנותר"><bdi dir="ltr" className={styles.digits}>{state.remaining === null ? "--:--:--" : duration(state.remaining)}</bdi></span>
            <span role="cell" data-label="מצב בקרה"><span className={`${styles.control} ${styles[state.tone]}`}
              aria-label={state.label} title={state.label}><i aria-hidden="true" />{state.label}</span>
              {warning && <span className={styles.serviceWarning} title={warning} aria-label={warning}><span aria-hidden="true">!</span> אזהרת כשירות</span>}</span>
          </div>;
        })}
      </div>}
      {ordered.length > 5 && <button className="button secondary" type="button" onClick={() => setShowAll(!showAll)}>{showAll ? "הצג פחות" : `הצג את כל הציוד (${ordered.length})`}</button>}
      {data && <Link className={styles.manageLink} href={`/incidents/${incidentId}/equipment`}>ניהול ציוד</Link>}
    </div>
  </section>;
}
