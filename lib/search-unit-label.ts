export const MANUAL_SEARCH_UNIT_ZONE_NAME = "הוספה ידנית";
const REPORTED_UNIT_LABEL_PREFIX = "מספר דירה שדווח בשטח:";

type SearchUnitLabelSource = {
  unit_number: string;
  zone_name: string | null;
  zone_type: string | null;
  zone_sequence: number | null;
  notes?: string | null;
};

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

export function reportedManualSearchUnitLabel(notes: string | null | undefined) {
  const line = notes?.split(/\r?\n/).find((value) => value.trim().startsWith(REPORTED_UNIT_LABEL_PREFIX));
  const label = line?.trim().slice(REPORTED_UNIT_LABEL_PREFIX.length).trim();
  return label || null;
}

export function searchUnitDisplayLabel(unit: SearchUnitLabelSource) {
  if (unit.zone_type === "other" && unit.zone_name === MANUAL_SEARCH_UNIT_ZONE_NAME) {
    return reportedManualSearchUnitLabel(unit.notes) ?? `${MANUAL_SEARCH_UNIT_ZONE_NAME} ${unit.zone_sequence ?? unit.unit_number}`;
  }

  if (unit.zone_type === "apartment" || !unit.zone_type) {
    return `דירה ${unit.unit_number}`;
  }

  if (unit.zone_type === "other" && unit.zone_name) {
    return `${unit.zone_name} ${unit.zone_sequence ?? unit.unit_number}`;
  }

  return `${zoneTypeLabel(unit.zone_type)} ${unit.zone_sequence ?? unit.unit_number}`;
}
