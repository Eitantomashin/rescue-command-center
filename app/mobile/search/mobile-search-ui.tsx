import Link from "next/link";
import { formatNumber } from "@/lib/format";
import {
  searchLiveStatus,
  searchScannedCount,
  searchSummaryFromStatuses
} from "@/lib/search-site-status";
import { addMobileSearchUnit, completeMobileSearchUnit, saveMobileSearchUnit } from "./actions";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";

export type MobileSearchFloor = {
  id: string;
  floor_number: number;
  is_active: boolean;
};

export type MobileSearchUnit = {
  id: string;
  floor_id: string;
  unit_number: string;
  zone_name: string | null;
  zone_type: string | null;
  zone_sequence: number | null;
  is_active: boolean;
};

export type MobileSearchResult = {
  unit_id: string;
  family_name: string | null;
  occupants_count: number | null;
  contact_phone: string | null;
  search_status: MobileSearchStatus | null;
  casualty_psych: boolean | null;
  casualty_body: boolean | null;
  medical_evacuation: boolean | null;
  anxiety_casualties_count: number | null;
  physical_casualties_count: number | null;
  casualties_resolved: boolean | null;
  casualties_resolved_at: string | null;
  has_apartment_damage: boolean | null;
  apartment_damage_notes: string | null;
  notes: string | null;
};

export type MobileSearchSite = {
  id: string;
  incident_id: string;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  search_status: string | null;
};

export type MobileSearchSummary = {
  total_units: number;
  not_visited_count: number;
  clear_count: number;
  no_answer_count: number;
  casualties_count: number;
  completed_count: number;
  reported_casualties_count?: number;
  open_casualties_count?: number;
  resolved_casualties_count?: number;
};

type MobileSearchStatus = "not_visited" | "no_answer" | "clear" | "casualties" | "completed";

const MANUAL_SEARCH_UNIT_ZONE_NAME = "הוספה ידנית";

const SEARCH_UNIT_STATUS_OPTIONS: Array<{ value: MobileSearchStatus; label: string }> = [
  { value: "not_visited", label: "טרם נסרקה" },
  { value: "no_answer", label: "אין מענה" },
  { value: "clear", label: "תקין" },
  { value: "casualties", label: "דווחו נפגעים" },
  { value: "completed", label: "סיום טיפול / מזוכה" }
];

const SEARCH_UNIT_STATUS_LABELS: Record<MobileSearchStatus, string> = {
  not_visited: "טרם נסרקה",
  no_answer: "אין מענה",
  clear: "תקין",
  casualties: "דווחו נפגעים",
  completed: "סיום טיפול / מזוכה"
};

function normalizeStatus(status: MobileSearchStatus | null | undefined): MobileSearchStatus {
  return status ?? "not_visited";
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasCasualtyFinding(result: MobileSearchResult | undefined) {
  return (
    numberValue(result?.anxiety_casualties_count) > 0 ||
    numberValue(result?.physical_casualties_count) > 0 ||
    Boolean(result?.casualty_psych) ||
    Boolean(result?.casualty_body) ||
    Boolean(result?.medical_evacuation)
  );
}

function effectiveSearchStatus(result: MobileSearchResult | undefined): MobileSearchStatus {
  const status = normalizeStatus(result?.search_status);
  if (status === "completed") return "completed";
  if (hasCasualtyFinding(result) && !result?.casualties_resolved) {
    return "casualties";
  }
  return status;
}

function searchUnitStatusLabel(status: MobileSearchStatus | null | undefined) {
  return SEARCH_UNIT_STATUS_LABELS[normalizeStatus(status)];
}

function searchUnitTone(status: MobileSearchStatus | null | undefined) {
  if (status === "completed") return "complete";
  if (status === "clear") return "clear";
  if (status === "casualties") return "casualties";
  if (status === "no_answer") return "no-answer";
  return "not-visited";
}

function siteName(site: MobileSearchSite) {
  return site.name?.trim() || [site.street, site.house_number].filter(Boolean).join(" ").trim() || "אתר סריקה";
}

function siteAddress(site: MobileSearchSite) {
  return [site.street, site.house_number, site.city].filter(Boolean).join(" ").trim();
}

function zoneTypeLabel(zoneType: string | null) {
  const labels = new Map([
    ["apartment", "דירה"],
    ["store", "חנות"],
    ["office", "משרד"],
    ["parking_area", "חניה"],
    ["lobby", "לובי"],
    ["shelter", "מקלט"],
    ["warehouse", "מחסן"],
    ["machine_room", "חדר מכונות"],
    ["commercial_area", "שטח מסחרי"],
    ["other", "אזור"]
  ]);

  return labels.get(zoneType ?? "") ?? "אזור";
}

function unitDisplayLabel(unit: MobileSearchUnit) {
  if (unit.zone_type === "apartment" || !unit.zone_type) {
    return `דירה ${unit.unit_number}`;
  }

  if (unit.zone_type === "other" && unit.zone_name) {
    return `${unit.zone_name} ${unit.zone_sequence ?? unit.unit_number}`;
  }

  return `${zoneTypeLabel(unit.zone_type)} ${unit.zone_sequence ?? unit.unit_number}`;
}

function isManualSearchUnit(unit: MobileSearchUnit) {
  return unit.zone_type === "other" && unit.zone_name === MANUAL_SEARCH_UNIT_ZONE_NAME;
}

function sortUnits(units: MobileSearchUnit[]) {
  return [...units].sort((a, b) =>
    a.unit_number.localeCompare(b.unit_number, "he", {
      numeric: true,
      sensitivity: "base"
    })
  );
}

function hiddenContext(incidentId: string, siteId: string, unitId?: string) {
  return (
    <>
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="siteId" value={siteId} />
      {unitId ? <input type="hidden" name="unitId" value={unitId} /> : null}
    </>
  );
}

function hiddenFloorContext(incidentId: string, siteId: string, floorId: string) {
  return (
    <>
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="floorId" value={floorId} />
    </>
  );
}

function liveSiteStatus(summary: MobileSearchSummary) {
  const scanned = summary.clear_count + summary.no_answer_count + summary.casualties_count + summary.completed_count;

  if (scanned === 0) {
    return { label: "טרם התחיל", tone: "not-started" };
  }

  if (summary.no_answer_count > 0 || summary.casualties_count > 0) {
    return { label: "ממצאים פתוחים", tone: "open-items" };
  }

  if (summary.total_units > 0 && scanned >= summary.total_units) {
    return { label: "אתר מזוכה", tone: "cleared" };
  }

  return { label: "בסריקה", tone: "in-progress" };
}

export function MobileSearchScanner({
  site,
  floors,
  unitsByFloor,
  searchResultsByUnit,
  summary,
  canEdit,
  reporterName
}: {
  site: MobileSearchSite;
  floors: MobileSearchFloor[];
  unitsByFloor: Map<string, MobileSearchUnit[]>;
  searchResultsByUnit: Map<string, MobileSearchResult>;
  summary: MobileSearchSummary;
  canEdit: boolean;
  reporterName: string;
}) {
  const sortedFloors = [...floors].sort((a, b) => (b.floor_number ?? 0) - (a.floor_number ?? 0));
  const scannedUnits = searchScannedCount(summary);
  const progressPercent = summary.total_units > 0 ? Math.round((scannedUnits / summary.total_units) * 100) : 0;
  const status = searchLiveStatus(summary);
  const allSearchResults = Array.from(searchResultsByUnit.values());
  const reportedCasualties = summary.reported_casualties_count ?? allSearchResults.reduce(
    (sum, result) => sum + numberValue(result.anxiety_casualties_count) + numberValue(result.physical_casualties_count),
    0
  );
  const openCasualtyUnits = summary.open_casualties_count ?? allSearchResults.filter((result) => hasCasualtyFinding(result) && !result.casualties_resolved).length;
  const resolvedCasualtyUnits = summary.resolved_casualties_count ?? allSearchResults.filter((result) => hasCasualtyFinding(result) && result.casualties_resolved).length;

  return (
    <main className="mobile-search-page">
      <header className="mobile-search-topbar mobile-search-site-topbar">
        <Link className="button compact secondary" href={`/mobile/search/${site.incident_id}`}>
          חזרה לאתרי הסריקה
        </Link>
        <div className="mobile-search-user">
          <span>מדווח:</span>
          <strong>{reporterName}</strong>
        </div>
      </header>

      <section className="mobile-search-hero">
        <span className="mobile-search-eyebrow">סריקת אתר</span>
        <h1>{siteName(site)}</h1>
        {siteAddress(site) ? <p>{siteAddress(site)}</p> : null}
        <div className={`mobile-search-hero-meta search-site-live-${status.tone}`}>
          <span>{status.label}</span>
          <strong>{formatNumber(progressPercent)}%</strong>
        </div>
      </section>

      <section className="search-progress-header mobile-search-progress" aria-label="התקדמות סריקה">
        <div className="search-progress-bar" aria-hidden="true">
          <span style={{ inlineSize: `${progressPercent}%` }} />
        </div>
        <div className="search-progress-metrics">
          <div><span>סה״כ</span><strong>{formatNumber(summary.total_units)}</strong></div>
          <div><span>נסרקו</span><strong>{formatNumber(scannedUnits)}</strong></div>
          <div><span>זוכו</span><strong>{formatNumber(summary.completed_count)}</strong></div>
          <div><span>אין מענה</span><strong>{formatNumber(summary.no_answer_count)}</strong></div>
          <div><span>נפגעים</span><strong>{formatNumber(summary.casualties_count)}</strong></div>
          <div><span>סה״כ נפגעים</span><strong>{formatNumber(reportedCasualties)}</strong></div>
          <div><span>נפגעים פתוחים</span><strong>{formatNumber(openCasualtyUnits)}</strong></div>
          <div><span>טיפול הושלם</span><strong>{formatNumber(resolvedCasualtyUnits)}</strong></div>
        </div>
      </section>

      {!canEdit ? (
        <section className="panel readonly-search-notice">
          <strong>תצוגה בלבד</strong>
          <p>אין הרשאה לעדכן תוצאות סריקה באתר זה או שהאתר סגור.</p>
        </section>
      ) : null}

      <section className="mobile-search-flow">
        {sortedFloors.length === 0 ? (
          <div className="empty-state">
            <h2>אין קומות להצגה</h2>
            <p className="muted">אתר הסריקה משתמש במבנה הקיים של קומות ודירות.</p>
          </div>
        ) : null}

        {sortedFloors.map((floor, index) => {
          const floorUnits = sortUnits((unitsByFloor.get(floor.id) ?? []).filter((unit) => unit.is_active));
          const floorStatuses = floorUnits.map((unit) => effectiveSearchStatus(searchResultsByUnit.get(unit.id)));
          const floorSummary = searchSummaryFromStatuses(floorStatuses);
          const floorStatus = searchLiveStatus(floorSummary);
          const scanned = searchScannedCount(floorSummary);
          const completed = floorSummary.completed_count;
          const openIssues = floorSummary.casualties_count + floorSummary.no_answer_count;

          return (
            <details className={`search-floor-card mobile-search-floor search-site-live-${floorStatus.tone}`} key={floor.id} name="mobile-search-floor" open={index === 0}>
              <summary className="search-floor-summary">
                <div>
                  <h2>קומה {floor.floor_number}</h2>
                  <p>{formatNumber(floorUnits.length)} דירות • {formatNumber(scanned)} נסרקו • {formatNumber(completed)} הושלמו • {formatNumber(openIssues)} פתוחות</p>
                </div>
                <span className={`search-status-badge search-site-live-${floorStatus.tone}`}>{floorStatus.label}</span>
                {openIssues > 0 ? <span className="search-alert-badge">{formatNumber(openIssues)} לטיפול</span> : null}
              </summary>

              {canEdit ? (
                <details className="mobile-search-add-unit-panel">
                  <summary className="button compact secondary">+ הוסף דירה לקומה</summary>
                  <form action={addMobileSearchUnit} className="mobile-search-add-unit-form">
                    {hiddenFloorContext(site.incident_id, site.id, floor.id)}
                    <label>
                      מספר דירה שדווח בשטח
                      <input className="input" name="reportedUnitNumber" inputMode="text" placeholder="אופציונלי" />
                    </label>
                    <label>
                      הערות
                      <textarea className="input" name="manualUnitNotes" rows={2} placeholder="אופציונלי" />
                    </label>
                    <p className="mobile-search-add-unit-help">
                      הדירה תוצג כ"הוספה ידנית" ולא תשנה מספרי דירות קיימים.
                    </p>
                    <OperationalLoadingButton className="button" label={"הוסף דירה"} loadingLabel={"יוצר..."} />
                  </form>
                </details>
              ) : null}

              <div className="search-unit-list">
                {floorUnits.map((unit) => {
                  const result = searchResultsByUnit.get(unit.id);
                  const status = effectiveSearchStatus(result);
                  const tone = searchUnitTone(status);

                  return (
                    <article className={`search-unit-card mobile-search-unit ${tone}`} key={unit.id}>
                      <div className="search-unit-card-header">
                        <div>
                          <h3>{unitDisplayLabel(unit)}</h3>
                          {isManualSearchUnit(unit) ? <span className="search-manual-unit-badge">נוספה בשטח</span> : null}
                          {result?.family_name ? <p>משפחה: {result.family_name}</p> : <p>משפחה לא צוינה</p>}
                        </div>
                        <span className={`search-unit-status ${tone}`}>{searchUnitStatusLabel(status)}</span>
                      </div>

                      <div className="search-quick-actions" aria-label="פעולות מהירות">
                        {[
                          { value: "clear", label: "תקין" },
                          { value: "no_answer", label: "אין מענה" },
                          { value: "casualties", label: "דווחו נפגעים" }
                        ].map((action) => (
                          <form action={saveMobileSearchUnit} key={action.value}>
                            {hiddenContext(site.incident_id, site.id, unit.id)}
                            <input type="hidden" name="familyName" value={result?.family_name ?? ""} />
                            <input type="hidden" name="occupantsCount" value={result?.occupants_count ?? ""} />
                            <input type="hidden" name="contactPhone" value={result?.contact_phone ?? ""} />
                            <input type="hidden" name="searchStatus" value={action.value} />
                            {result?.casualty_psych ? <input type="hidden" name="casualtyPsych" value="on" /> : null}
                            {result?.casualty_body ? <input type="hidden" name="casualtyBody" value="on" /> : null}
                            {action.value === "casualties" ? <input type="hidden" name="casualtyBody" value="on" /> : null}
                            {result?.medical_evacuation ? <input type="hidden" name="medicalEvacuation" value="on" /> : null}
                            <input type="hidden" name="anxietyCasualtiesCount" value={result?.anxiety_casualties_count ?? 0} />
                            <input type="hidden" name="physicalCasualtiesCount" value={result?.physical_casualties_count ?? 0} />
                            {result?.has_apartment_damage ? <input type="hidden" name="hasApartmentDamage" value="on" /> : null}
                            <input type="hidden" name="apartmentDamageNotes" value={result?.apartment_damage_notes ?? ""} />
                            <input type="hidden" name="notes" value={result?.notes ?? ""} />
                            <OperationalLoadingButton className={`button compact search-quick-button ${searchUnitTone(action.value as MobileSearchStatus)}`} label={action.label} loadingLabel={"מעדכן..."} disabled={!canEdit} />
                          </form>
                        ))}
                        <form action={completeMobileSearchUnit}>
                          {hiddenContext(site.incident_id, site.id, unit.id)}
                          <OperationalLoadingButton className="button compact search-quick-button complete" label={"סיום טיפול / מזוכה"} loadingLabel={"מעדכן..."} disabled={!canEdit || status === "completed"} />
                        </form>
                      </div>

                      <div className="search-unit-indicators">
                        {result?.occupants_count !== null && result?.occupants_count !== undefined ? <span>דיירים: {formatNumber(result.occupants_count)}</span> : null}
                        {result?.contact_phone ? <span>טלפון: {result.contact_phone}</span> : null}
                        {result?.casualty_psych ? <span className="warning">נפגע חרדה</span> : null}
                        {result?.casualty_body ? <span className="danger">נפגע גוף</span> : null}
                        {numberValue(result?.anxiety_casualties_count) > 0 ? <span className="warning">נפגעי חרדה: {formatNumber(numberValue(result?.anxiety_casualties_count))}</span> : null}
                        {numberValue(result?.physical_casualties_count) > 0 ? <span className="danger">נפגעי גוף: {formatNumber(numberValue(result?.physical_casualties_count))}</span> : null}
                        {result?.medical_evacuation ? <span className="danger">נדרש פינוי</span> : null}
                        {hasCasualtyFinding(result) && status === "completed" ? <span className="success">היו נפגעים - הטיפול הושלם</span> : null}
                        {hasCasualtyFinding(result) && status !== "completed" && !result?.casualties_resolved ? <span className="danger">נפגעים פתוחים</span> : null}
                        {result?.has_apartment_damage ? <span className="warning">נזק לדירה</span> : null}
                        {result?.apartment_damage_notes ? <span className="search-unit-note-chip">פירוט נזק: {result.apartment_damage_notes}</span> : null}
                      </div>

                      <details className="search-unit-detail-panel">
                        <summary>פתח טופס מלא</summary>
                        <form action={saveMobileSearchUnit} className="search-unit-form">
                          {hiddenContext(site.incident_id, site.id, unit.id)}
                          <label>
                            שם משפחה
                            <input className="input" name="familyName" defaultValue={result?.family_name ?? ""} disabled={!canEdit} />
                          </label>
                          <label>
                            מספר דיירים
                            <input className="input" name="occupantsCount" type="number" min="0" inputMode="numeric" defaultValue={result?.occupants_count ?? ""} disabled={!canEdit} />
                          </label>
                          <label>
                            טלפון קשר
                            <input className="input" name="contactPhone" type="tel" defaultValue={result?.contact_phone ?? ""} disabled={!canEdit} />
                          </label>
                          <label>
                            מספר נפגעי חרדה
                            <input className="input" name="anxietyCasualtiesCount" type="number" min="0" inputMode="numeric" defaultValue={result?.anxiety_casualties_count ?? 0} disabled={!canEdit} />
                          </label>
                          <label>
                            מספר נפגעי גוף
                            <input className="input" name="physicalCasualtiesCount" type="number" min="0" inputMode="numeric" defaultValue={result?.physical_casualties_count ?? 0} disabled={!canEdit} />
                          </label>
                          <label>
                            סטטוס סריקה
                            <select className="input" name="searchStatus" defaultValue={status} disabled={!canEdit}>
                              {SEARCH_UNIT_STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <div className="search-unit-checks">
                            <label><input type="checkbox" name="casualtyPsych" defaultChecked={Boolean(result?.casualty_psych)} disabled={!canEdit} /> נפגע חרדה</label>
                            <label><input type="checkbox" name="casualtyBody" defaultChecked={Boolean(result?.casualty_body)} disabled={!canEdit} /> נפגע גוף</label>
                            <label><input type="checkbox" name="medicalEvacuation" defaultChecked={Boolean(result?.medical_evacuation)} disabled={!canEdit} /> פינוי רפואי</label>
                            <label><input type="checkbox" name="hasApartmentDamage" defaultChecked={Boolean(result?.has_apartment_damage)} disabled={!canEdit} /> קיים נזק לדירה</label>
                          </div>

                          <label className="search-unit-notes">
                            פירוט נזק
                            <textarea className="input" name="apartmentDamageNotes" rows={2} defaultValue={result?.apartment_damage_notes ?? ""} disabled={!canEdit} />
                          </label>

                          <label className="search-unit-notes">
                            הערות
                            <textarea className="input" name="notes" rows={3} defaultValue={result?.notes ?? ""} disabled={!canEdit} />
                          </label>

                          <div className="search-unit-actions">
                            <OperationalLoadingButton className="button" label={"שמור סריקה"} loadingLabel={"שומר..."} disabled={!canEdit} />
                          </div>
                        </form>
                      </details>
                    </article>
                  );
                })}
              </div>
            </details>
          );
        })}
      </section>
    </main>
  );
}
