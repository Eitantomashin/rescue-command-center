import { duration, type Equipment } from "./equipment-model";
import { controlState } from "./equipment-presentation";
import styles from "./equipment.module.css";

export function EquipmentIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V4h8v3M3 12h18M9 10v4m6-4v4" />
  </svg>;
}
export function FuelGauge({ row, serverTime }: { row: Equipment; serverTime: number | null }) {
  const state = controlState(row, serverTime);
  return <span className={`${styles.fuel} ${styles[state.tone]}`} role="img"
    aria-label={`יתרת זמן עבודה משוערת: ${Math.round(state.fuel)}%. ${state.label}`} title="מחוון המבוסס על זמן העבודה, ולא על מדידת דלק פיזית">
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="4" opacity=".18" />
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="4" pathLength="100"
        strokeDasharray={`${state.fuel} 100`} transform="rotate(-90 20 20)" />
      <path d="M14 27V14h9v13m-9-8h9m-11 8h13m-2-11 4 3v5c0 2 3 2 3 0v-7l-3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  </span>;
}
export function EquipmentTime({ row, serverTime }: { row: Equipment; serverTime: number | null }) {
  const state = controlState(row, serverTime);
  return <div className={styles.timeInline}><FuelGauge row={row} serverTime={serverTime} /><div>
    <strong dir="ltr" className={styles.compactDigits}>{state.remaining === null ? "--:--:--" : duration(state.remaining)}</strong>
    <span className={styles.timeLabel}>{state.label}{row.operation_state === "paused" ? " · מושהה" : ""}</span>
  </div></div>;
}
