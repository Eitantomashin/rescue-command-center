"use client";

import { formatNumber } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { markSearchResidentEvacuated } from "./actions";
import { formatSearchEvacuatedAt, searchCasualtyPersonStatusLabel, searchCasualtyPersonTreatmentLabel, searchEvacuationState, type SearchCasualtyPerson } from "@/lib/search-casualty-person";
import { searchOperationalKpiCollections, type SearchOperationalUnit } from "@/lib/search-operational-kpis";
import { searchUnitProcessLabel, searchUnitStatusTone } from "@/lib/search-site-status";

function PersonRows({ people, canMarkEvacuated }: { people: SearchCasualtyPerson[]; canMarkEvacuated: boolean }) {
  const router = useRouter(); const [pending, setPending] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const evacuate = async (person: SearchCasualtyPerson) => { const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || "הדייר"; if (!window.confirm(`לסמן שהפינוי של ${name} הושלם?`)) return; setPending(person.residentId); setError(null); const result = await markSearchResidentEvacuated(person.residentId); setPending(null); if (!result.success) { setError(result.error ?? "לא ניתן היה לעדכן את הפינוי. נסה שוב."); return; } router.refresh(); };
  return <><ul className="search-kpi-drilldown-list">{people.length ? people.map((person) => { const evacuation = searchEvacuationState(person); return <li key={person.residentId}><strong>{[person.firstName, person.lastName].filter(Boolean).join(" ") || "ללא שם"}</strong><span>קומה {person.floorNumber ?? "-"} · דירה {person.unitNumber}</span><span>{searchCasualtyPersonStatusLabel(person.status)}</span><span>{evacuation === "waiting" ? "ממתין לפינוי" : evacuation === "evacuated" ? "פונה" : "לא נדרש פינוי"}</span>{evacuation === "evacuated" && formatSearchEvacuatedAt(person.evacuatedAt) ? <span>פונה ב: {formatSearchEvacuatedAt(person.evacuatedAt)}</span> : null}<span>{searchCasualtyPersonTreatmentLabel(person.casualtiesResolved)}</span>{canMarkEvacuated && evacuation === "waiting" ? <button className="button compact" type="button" disabled={pending === person.residentId} onClick={() => evacuate(person)}>{pending === person.residentId ? "מעדכן..." : "פונה"}</button> : null}</li>; }) : <li className="muted">אין פרטים להצגה</li>}</ul>{error ? <p className="form-error" role="alert">{error}</p> : null}</>;
}

function UnitRows({ units, people, casualty, canMarkEvacuated }: { units: SearchOperationalUnit[]; people: SearchCasualtyPerson[]; casualty?: boolean; canMarkEvacuated: boolean }) {
  return <ul className="search-kpi-drilldown-list">{units.length ? units.map((unit) => { const unitPeople = people.filter((person) => person.unitId === unit.unitId); return <li key={unit.unitId}><span>קומה {unit.floorNumber ?? "-"}</span><strong>{unit.unitLabel}</strong><span className={`search-unit-status ${searchUnitStatusTone(unit.status)}`}>{searchUnitProcessLabel(unit.status)}</span>{unit.hasApartmentDamage ? <span>{unit.apartmentDamageNotes ? `נזק: ${unit.apartmentDamageNotes}` : "דווח נזק לדירה"}</span> : null}{casualty ? unitPeople.length ? <PersonRows people={unitPeople} canMarkEvacuated={canMarkEvacuated} /> : <span>אין פרטי נפגע פעילים</span> : null}</li>; }) : <li className="muted">אין דירות להצגה</li>}</ul>;
}

function Kpi({ label, value, children, tone = "search-kpi-total" }: { label: string; value: number; children: ReactNode; tone?: string }) {
  return <details className={`search-kpi-click-card ${tone}`}><summary><span>{label}</span><strong>{formatNumber(value)}</strong></summary><div className="search-kpi-drilldown-panel">{children}</div></details>;
}

function KpiRow({ label, children }: { label: string; children: ReactNode }) {
  return <section className="search-kpi-group"><div className="search-kpi-row"><h3>{label}</h3><div className="search-site-summary-grid search-clickable-kpis">{children}</div></div></section>;
}

export function SearchOperationalKpis({ units, people, canMarkEvacuated = false }: { units: SearchOperationalUnit[]; people: SearchCasualtyPerson[]; canMarkEvacuated?: boolean }) {
  const kpis = searchOperationalKpiCollections(units, people);
  const unit = (label: string, values: SearchOperationalUnit[], tone?: string, casualty?: boolean) => <Kpi label={label} value={values.length} tone={tone}><UnitRows units={values} people={people} casualty={casualty} canMarkEvacuated={canMarkEvacuated} /></Kpi>;
  const person = (label: string, values: SearchCasualtyPerson[], tone?: string) => <Kpi label={label} value={values.length} tone={tone}><PersonRows people={values} canMarkEvacuated={canMarkEvacuated} /></Kpi>;
  return <><KpiRow label="סטטוס הסריקה">{unit("סה״כ דירות", kpis.process.total)}{unit("טרם התחילה", kpis.process.notStarted, "search-kpi-no-answer")}{unit("בסריקה", kpis.process.inProgress, "search-kpi-scanned")}{unit("אין מענה", kpis.process.noAnswer, "search-kpi-no-answer")}{unit("סריקה הושלמה", kpis.process.completed, "search-kpi-completed")}</KpiRow><KpiRow label="ממצאים בדירות">{unit("דירות שזוכו", kpis.findings.cleared, "search-kpi-completed")}{unit("דירות עם נזק", kpis.findings.damaged, "search-kpi-damage")}{unit("טיפול בנפגעים פתוח", kpis.findings.openCasualties, "search-kpi-danger", true)}{unit("טיפול בנפגעים הסתיים", kpis.findings.resolvedCasualties, "search-kpi-completed", true)}</KpiRow><KpiRow label="תמונת נפגעים ופינוי">{person("נפגעי חרדה", kpis.findings.anxiety, "search-kpi-warning")}{person("נפגעי גוף", kpis.findings.physical, "search-kpi-danger")}{person("חללים", kpis.findings.deceased, "search-kpi-danger")}{person("ממתינים לפינוי", kpis.findings.waitingEvacuation, "search-kpi-warning")}</KpiRow></>;
}
