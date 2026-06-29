import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeSearchUnitStatus, searchSummaryFromStatuses, type SearchUnitStatus } from "@/lib/search-site-status";
import type { SearchSitesWidgetData, SearchSiteWidgetSite } from "../search-sites-dashboard-widget";

type SearchSiteRow = {
  id: string;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  parent_site_id: string | null;
  search_reason: string | null;
  search_priority: string | null;
};

type FloorRow = {
  id: string;
  floor_number: number | null;
};

type UnitRow = {
  id: string;
  site_id: string;
  floor_id: string | null;
  unit_number: string;
  zone_type: string | null;
  zone_name: string | null;
  zone_sequence: number | null;
};

type SearchResultRow = {
  unit_id: string;
  family_name: string | null;
  occupants_count: number | null;
  search_status: string | null;
  casualty_psych: boolean | null;
  casualty_body: boolean | null;
  medical_evacuation: boolean | null;
  anxiety_casualties_count: number | null;
  physical_casualties_count: number | null;
  casualties_resolved: boolean | null;
  has_apartment_damage: boolean | null;
  apartment_damage_notes: string | null;
  notes: string | null;
};

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function effectiveSearchStatus(result: SearchResultRow | undefined): SearchUnitStatus {
  const status = normalizeSearchUnitStatus(result?.search_status);
  if (status === "completed") return "completed";
  if (
    numberValue(result?.anxiety_casualties_count) > 0 ||
    numberValue(result?.physical_casualties_count) > 0 ||
    result?.casualty_psych ||
    result?.casualty_body ||
    result?.medical_evacuation
  ) {
    return result?.casualties_resolved ? status : "casualties";
  }
  return status;
}

function siteName(site: Pick<SearchSiteRow, "name" | "street" | "house_number">) {
  return site.name?.trim() || [site.street, site.house_number].filter(Boolean).join(" ").trim() || "אתר סריקה";
}

function siteAddress(site: Pick<SearchSiteRow, "street" | "house_number" | "city">) {
  return [site.street, site.house_number, site.city].filter(Boolean).join(" ").trim() || null;
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

function unitLabel(unit: UnitRow) {
  if (unit.zone_type === "apartment" || !unit.zone_type) {
    return `דירה ${unit.unit_number}`;
  }

  if (unit.zone_type === "other" && unit.zone_name) {
    return `${unit.zone_name} ${unit.zone_sequence ?? unit.unit_number}`;
  }

  return `${zoneTypeLabel(unit.zone_type)} ${unit.zone_sequence ?? unit.unit_number}`;
}

export async function GET(_request: Request, { params }: { params: { incidentId: string } }) {
  const supabase = createClient();

  const [{ data: searchSites }, { data: allSites }, { data: floors }, { data: units }, { data: searchResults }] = await Promise.all([
    supabase
      .from("sites")
      .select("id,name,city,street,house_number,parent_site_id,search_reason,search_priority")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
      .eq("site_type", "search_site")
      .order("created_at", { ascending: true }),
    supabase
      .from("sites")
      .select("id,name,city,street,house_number,parent_site_id,search_reason,search_priority")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true),
    supabase
      .from("floors")
      .select("id,floor_number")
      .eq("incident_id", params.incidentId),
    supabase
      .from("units")
      .select("id,site_id,floor_id,unit_number,zone_type,zone_name,zone_sequence")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true),
    supabase
      .from("site_search_units")
      .select("unit_id,family_name,occupants_count,search_status,casualty_psych,casualty_body,medical_evacuation,anxiety_casualties_count,physical_casualties_count,casualties_resolved,has_apartment_damage,apartment_damage_notes,notes")
      .eq("incident_id", params.incidentId)
  ]);

  const parentNames = new Map(((allSites ?? []) as SearchSiteRow[]).map((site) => [site.id, siteName(site)]));
  const floorNumbers = new Map(((floors ?? []) as FloorRow[]).map((floor) => [floor.id, floor.floor_number]));
  const resultsByUnit = new Map(((searchResults ?? []) as SearchResultRow[]).map((result) => [result.unit_id, result]));
  const unitsBySite = ((units ?? []) as UnitRow[]).reduce((map, unit) => {
    const siteUnits = map.get(unit.site_id) ?? [];
    siteUnits.push(unit);
    map.set(unit.site_id, siteUnits);
    return map;
  }, new Map<string, UnitRow[]>());

  const sites: SearchSiteWidgetSite[] = ((searchSites ?? []) as SearchSiteRow[]).map((site) => {
    const siteUnits = unitsBySite.get(site.id) ?? [];
    const entries = siteUnits
      .sort((a, b) =>
        (floorNumbers.get(a.floor_id ?? "") ?? -999) - (floorNumbers.get(b.floor_id ?? "") ?? -999) ||
        unitLabel(a).localeCompare(unitLabel(b), "he", { numeric: true, sensitivity: "base" })
      )
      .map((unit) => {
        const result = resultsByUnit.get(unit.id);
        return {
          unitId: unit.id,
          siteName: siteName(site),
          floorNumber: floorNumbers.get(unit.floor_id ?? "") ?? null,
          unitLabel: unitLabel(unit),
          familyName: result?.family_name ?? null,
          occupantsCount: result?.occupants_count ?? null,
          status: effectiveSearchStatus(result),
          anxietyCasualtiesCount: numberValue(result?.anxiety_casualties_count),
          physicalCasualtiesCount: numberValue(result?.physical_casualties_count),
          casualtiesResolved: Boolean(result?.casualties_resolved),
          hasCasualtyFinding: Boolean(
            numberValue(result?.anxiety_casualties_count) > 0 ||
            numberValue(result?.physical_casualties_count) > 0 ||
            result?.casualty_psych ||
            result?.casualty_body ||
            result?.medical_evacuation
          ),
          medicalEvacuation: Boolean(result?.medical_evacuation),
          hasApartmentDamage: Boolean(result?.has_apartment_damage),
          apartmentDamageNotes: result?.apartment_damage_notes ?? null,
          notes: result?.notes ?? null
        };
      });

    return {
      id: site.id,
      name: siteName(site),
      address: siteAddress(site),
      parentName: site.parent_site_id ? parentNames.get(site.parent_site_id) ?? null : null,
      searchPriority: site.search_priority,
      searchReason: site.search_reason,
      summary: searchSummaryFromStatuses(entries.map((entry) => entry.status)),
      anxietyCasualtiesCount: entries.reduce((sum, entry) => sum + entry.anxietyCasualtiesCount, 0),
      physicalCasualtiesCount: entries.reduce((sum, entry) => sum + entry.physicalCasualtiesCount, 0),
      damagedUnitsCount: entries.filter((entry) => entry.hasApartmentDamage).length,
      entries
    };
  });

  const payload: SearchSitesWidgetData = {
    sites,
    updatedAt: new Date().toISOString()
  };

  return NextResponse.json(payload);
}
