import Link from "next/link";
import { formatNumber } from "@/lib/format";
import {
  searchLiveStatus,
  searchScannedCount,
  searchSummaryFromStatuses
} from "@/lib/search-site-status";
import { addMobileSearchUnit } from "./actions";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { SearchUnitCard } from "./search-unit-card";
import { normalizeResidentStatus } from "./search-unit-card-logic";

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
  known_people_count: number | null;
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
export type MobileSearchResident = { id: string; unit_id: string; first_name: string | null; last_name: string | null; age: number | null; phone: string | null; notes: string | null; gender: "unknown" | "male" | "female" | null; requires_medical_evacuation: boolean | null; status_key: string | null };

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
  residentsByUnit,
  summary,
  canEdit,
  reporterName
}: {
  site: MobileSearchSite;
  floors: MobileSearchFloor[];
  unitsByFloor: Map<string, MobileSearchUnit[]>;
  searchResultsByUnit: Map<string, MobileSearchResult>;
  residentsByUnit: Map<string, MobileSearchResident[]>;
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

                  return <SearchUnitCard key={unit.id} incidentId={site.incident_id} siteId={site.id} unitId={unit.id} label={unitDisplayLabel(unit)} floor={floor.floor_number} canEdit={canEdit} initial={{ knownPeopleCount: unit.known_people_count, damage: Boolean(result?.has_apartment_damage), damageNotes: result?.apartment_damage_notes ?? null, notes: result?.notes ?? null, status: status, hadCasualties: hasCasualtyFinding(result) || Boolean(result?.casualties_resolved), residents: (residentsByUnit.get(unit.id) ?? []).map((resident) => ({ id: resident.id, first_name: resident.first_name ?? "", last_name: resident.last_name ?? "", age: resident.age?.toString() ?? "", phone: resident.phone ?? "", notes: resident.notes ?? "", gender: resident.gender ?? "unknown", ...normalizeResidentStatus(resident.status_key, Boolean(resident.requires_medical_evacuation)) })) }} />;
                })}
              </div>
            </details>
          );
        })}
      </section>
    </main>
  );
}
