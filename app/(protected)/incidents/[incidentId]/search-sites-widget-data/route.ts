import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeSearchUnitStatus, searchSummaryFromStatuses, type SearchUnitStatus } from "@/lib/search-site-status";
import { isActiveSearchCasualtyPerson, isSearchCasualtyPersonStatus, type SearchCasualtyPerson } from "@/lib/search-casualty-person";
import { searchOperationalGapDrilldown } from "@/lib/search-population-operational-gap";
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

type SitePopulationRow = {
  site_id: string;
  initial_potential: number;
  updated_potential: number;
  operational_gap: number;
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
  known_people_count: number | null;
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

type SearchCasualtyResidentRow = {
  id: string;
  site_id: string;
  unit_id: string;
  first_name: string | null;
  last_name: string | null;
  requires_evacuation: boolean | null;
  evacuated_at: string | null;
  is_active: boolean;
  status_types: { status_key: string } | null;
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

  const [{ data: searchSites }, { data: allSites }, { data: siteSummaries }, { data: floors }, { data: units }, { data: searchResults }, { data: casualtyResidents }] = await Promise.all([
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
      .from("site_dashboard_summary")
      .select("site_id,initial_potential,updated_potential,operational_gap")
      .eq("incident_id", params.incidentId),
    supabase
      .from("floors")
      .select("id,floor_number")
      .eq("incident_id", params.incidentId),
    supabase
      .from("units")
      .select("id,site_id,floor_id,unit_number,zone_type,zone_name,zone_sequence,known_people_count")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true),
    supabase
      .from("site_search_units")
      .select("unit_id,family_name,occupants_count,search_status,casualty_psych,casualty_body,medical_evacuation,anxiety_casualties_count,physical_casualties_count,casualties_resolved,has_apartment_damage,apartment_damage_notes,notes")
      .eq("incident_id", params.incidentId)
    ,supabase
      .from("unit_residents")
      .select("id,site_id,unit_id,first_name,last_name,requires_evacuation,evacuated_at,is_active,status_types!inner(status_key)")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
  ]);

  const parentNames = new Map(((allSites ?? []) as SearchSiteRow[]).map((site) => [site.id, siteName(site)]));
  const sitePopulationById = new Map(((siteSummaries ?? []) as SitePopulationRow[]).map((site) => [site.site_id, site]));
  const floorNumbers = new Map(((floors ?? []) as FloorRow[]).map((floor) => [floor.id, floor.floor_number]));
  const resultsByUnit = new Map(((searchResults ?? []) as SearchResultRow[]).map((result) => [result.unit_id, result]));
  const unitsBySite = ((units ?? []) as UnitRow[]).reduce((map, unit) => {
    const siteUnits = map.get(unit.site_id) ?? [];
    siteUnits.push(unit);
    map.set(unit.site_id, siteUnits);
    return map;
  }, new Map<string, UnitRow[]>());
  const unitsById = new Map(((units ?? []) as UnitRow[]).map((unit) => [unit.id, unit]));
  const residentsByUnit = ((casualtyResidents ?? []) as unknown as SearchCasualtyResidentRow[]).reduce((grouped, resident) => {
    const rows = grouped.get(resident.unit_id) ?? [];
    rows.push(resident);
    grouped.set(resident.unit_id, rows);
    return grouped;
  }, new Map<string, SearchCasualtyResidentRow[]>());
  const casualtyPeopleBySite = ((casualtyResidents ?? []) as unknown as SearchCasualtyResidentRow[]).reduce((grouped, resident) => {
    const unit = unitsById.get(resident.unit_id);
    const status = resident.status_types?.status_key;
    if (!unit || unit.site_id !== resident.site_id || !isActiveSearchCasualtyPerson({ isActive: resident.is_active, status }) || !isSearchCasualtyPersonStatus(status)) return grouped;
    const people = grouped.get(resident.site_id) ?? [];
    const result = resultsByUnit.get(unit.id);
    people.push({
      residentId: resident.id,
      unitId: unit.id,
      floorNumber: floorNumbers.get(unit.floor_id ?? "") ?? null,
      unitNumber: unit.unit_number,
      firstName: resident.first_name ?? "",
      lastName: resident.last_name,
      status,
      requiresEvacuation: Boolean(resident.requires_evacuation),
      evacuatedAt: resident.evacuated_at,
      casualtiesResolved: Boolean(result?.casualties_resolved)
    });
    grouped.set(resident.site_id, people);
    return grouped;
  }, new Map<string, SearchCasualtyPerson[]>());

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
      initialPotential: sitePopulationById.get(site.id)?.initial_potential ?? null,
      updatedPotential: sitePopulationById.get(site.id)?.updated_potential ?? null,
      operationalGap: sitePopulationById.get(site.id)?.operational_gap ?? null,
      operationalGapEntries: searchOperationalGapDrilldown(siteUnits.map((unit) => ({
        unitId: unit.id,
        siteName: siteName(site),
        floorNumber: floorNumbers.get(unit.floor_id ?? "") ?? null,
        unitLabel: unitLabel(unit),
        knownPeopleCount: unit.known_people_count,
        casualtiesResolved: Boolean(resultsByUnit.get(unit.id)?.casualties_resolved),
        residents: (residentsByUnit.get(unit.id) ?? []).map((resident) => ({
          residentId: resident.id,
          firstName: resident.first_name ?? "",
          lastName: resident.last_name,
          isActive: resident.is_active,
          statusKey: resident.status_types?.status_key ?? null,
          requiresEvacuation: Boolean(resident.requires_evacuation),
          evacuatedAt: resident.evacuated_at
        }))
      }))).entries,
      summary: searchSummaryFromStatuses(entries.map((entry) => entry.status)),
      casualtyPeople: casualtyPeopleBySite.get(site.id) ?? [],
      entries
    };
  });

  const payload: SearchSitesWidgetData = {
    sites,
    updatedAt: new Date().toISOString()
  };

  return NextResponse.json(payload);
}
