"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { watchEquipment } from "./equipment-realtime";
import { EquipmentAlertController, type AlertView } from "./alert-controller";
import { EquipmentAlertAudio, type AudioStatus } from "./alert-audio";
import { ackEquipmentAlert, claimEquipmentAlerts, dismissEquipmentAlert, syncEquipmentAlerts } from "./alert-actions";
import { ALERT_POLL_MS, alertLabels, presentationKey, type Presentation } from "./alert-model";
import { duration, equipmentTiming, teamLabel } from "./equipment-model";
import styles from "./equipment-alerts.module.css";
import { EquipmentRefreshContext } from "./equipment-refresh-context";

export function EquipmentAlertDialog({ row, serverTime, count, presented, dismiss }: {
  row: Presentation; serverTime: number; count: number; presented: (key: string) => void; dismiss: (key: string) => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const key = presentationKey(row);
  const remaining = equipmentTiming(row.alert, serverTime).remaining;
  const severity = remaining <= 0 ? "critical" : row.alert.severity;
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    presented(key);
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, [key, presented]);
  async function close() {
    if (busy) return;
    setBusy(true);
    try { await dismiss(key); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={`${styles.dialog} ${styles[severity]}`} dir="rtl" aria-labelledby="equipment-alert-title"
    onCancel={(event) => { event.preventDefault(); void close(); }}>
    <h2 id="equipment-alert-title">{alertLabels[severity]}</h2>
    <p className={styles.asset}>{row.alert.asset_identifier_snapshot} · {row.alert.equipment_type_name_snapshot}</p>
    {row.alert.serial_number && <p>מספר סידורי: <bdi>{row.alert.serial_number}</bdi></p>}
    <p>צוות: {teamLabel(row.alert)}</p><p>מיקום: {row.alert.location || "לא צוין"}</p>
    <p>{remaining < 0 ? "חריגה מזמן העבודה" : "זמן שנותר"}</p>
    <strong className={styles.clock} dir="ltr">{duration(remaining)}</strong>
    <p>ההתרעה זוהתה: <bdi>{new Date(row.alert.detected_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</bdi></p>
    <p>{count > 1 ? `${count - 1} התרעות נוספות ממתינות` : "אין התרעות נוספות בתור זה"}</p>
    <div className={styles.actions}>
      <button type="button" className="button" disabled={busy} onClick={() => void close()}>{busy ? "מאשר דחייה…" : "סגור וחזור בעוד 5 דקות"}</button>
      <Link className="button secondary" href={`/incidents/${row.alert.incident_id}/equipment`} onClick={() => void close()}>מעבר לניהול ציוד</Link>
    </div>
    <p className="muted">סגירה דוחה את ההצגה בלבד. היא אינה מאשרת תדלוק.</p>
  </dialog>;
}

export function EquipmentAlertsProvider({ incidentId, userId, canRead, canOperate, children }: {
  incidentId: string; userId: string; canRead: boolean; canOperate: boolean; children: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<AlertView>({ queue: [], serverTime: null, error: null, ready: false });
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("required");
  const controller = useRef<EquipmentAlertController | null>(null);
  const audio = useRef<EquipmentAlertAudio | null>(null);
  // Stable callbacks: rendering a tick must never close/reopen the native dialog.
  const callbacks = useRef({ presented: (key: string) => { void controller.current?.presented(key); },
    dismiss: async (key: string) => { await controller.current?.dismiss(key); } });

  useEffect(() => {
    if (!canRead) return;
    let live = true;
    const bump = () => { if (live) setRevision((value) => value + 1); };
    const sound = new EquipmentAlertAudio((state) => { if (live) setAudioStatus(state); });
    audio.current = sound;
    const engine = canOperate ? new EquipmentAlertController(incidentId, {
      sync: () => syncEquipmentAlerts(incidentId), claim: (token) => claimEquipmentAlerts(incidentId, token),
      ack: (id, token) => ackEquipmentAlert(incidentId, id, token), dismiss: (id, token) => dismissEquipmentAlert(incidentId, id, token)
    }, setView, (severity) => sound.play(severity), () => performance.now(), () => crypto.randomUUID()) : null;
    controller.current = engine;
    const resume = () => { if (document.visibilityState === "visible") { bump(); void engine?.resume(); } else engine?.suspend(); };
    const unwatch = watchEquipment(incidentId, userId, (signal) => {
      if (signal.kind === "disconnected") { engine?.disconnect(); return; }
      if (!signal.presentationOnly) bump();
      if (signal.kind === "connected") resume(); else void engine?.requestSync();
    });
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") { bump(); void engine?.requestSync(); } }, ALERT_POLL_MS);
    const tick = window.setInterval(() => engine?.tick(), 1000); // local rendering only
    resume();
    return () => {
      live = false; unwatch(); engine?.stop(); sound.close(); controller.current = null; audio.current = null;
      window.clearInterval(poll); window.clearInterval(tick);
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume); window.removeEventListener("online", resume);
    };
  }, [incidentId, userId, canRead, canOperate]);

  const first = view.queue[0];
  return <EquipmentRefreshContext.Provider value={revision}>
    {canRead && canOperate && <section className={styles.controls} dir="rtl" aria-label="התרעות ציוד">
      <span role="status">{audioStatus === "enabled" ? "צלילים פעילים" : audioStatus === "blocked" ? "הדפדפן חסם השמעה — ההתרעות החזותיות ממשיכות לפעול" : "נדרשת הפעלת צלילים"}</span>
      <button className="button secondary" type="button" onClick={() => void audio.current?.enable()}>הפעל צלילי התראה</button>
      <button className="button secondary" type="button" onClick={() => audio.current?.play("warning")}>בדיקת צליל</button>
      {view.error && <p className={styles.error} role="status">{view.error}</p>}
    </section>}
    {children}
    {canRead && canOperate && first && view.serverTime !== null && <EquipmentAlertDialog row={first} serverTime={view.serverTime}
      count={view.queue.length} presented={callbacks.current.presented} dismiss={callbacks.current.dismiss} />}
  </EquipmentRefreshContext.Provider>;
}
