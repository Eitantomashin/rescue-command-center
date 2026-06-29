import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  MobileSearchFloor,
  MobileSearchResult,
  MobileSearchScanner,
  MobileSearchSite,
  MobileSearchSummary,
  MobileSearchUnit
} from "../../mobile-search-ui";

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSummary(row: Partial<MobileSearchSummary> | null | undefined): MobileSearchSummary {
  return {
    total_units: numberValue(row?.total_units),
    not_visited_count: numberValue(row?.not_visited_count),
    clear_count: numberValue(row?.clear_count),
    no_answer_count: numberValue(row?.no_answer_count),
    casualties_count: numberValue(row?.casualties_count),
    completed_count: numberValue(row?.completed_count)
  };
}

function userDisplayName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  const metadata = user.user_metadata ?? {};
  const displayName = String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? "").trim();
  return displayName || user.email || "משתמש סריקה";
}

function liveSummaryFromRows(units: MobileSearchUnit[], resultsByUnit: Map<string, MobileSearchResult>) {
  const summary = normalizeSummary(null);
  summary.total_units = units.filter((unit) => unit.is_active).length;

  for (const unit of units) {
    if (!unit.is_active) continue;
    const result = resultsByUnit.get(unit.id);
    const status =
      Number(result?.anxiety_casualties_count ?? 0) > 0 ||
            Number(result?.physical_casualties_count ?? 0) > 0 ||
            result?.casualty_psych ||
            result?.casualty_body
          ? "casualties"
          : result?.search_status ?? "not_visited";

    if (status === "clear") summary.clear_count += 1;
    else if (status === "no_answer") summary.no_answer_count += 1;
    else if (status === "casualties") summary.casualties_count += 1;
    else if (status === "completed") summary.completed_count += 1;
    else summary.not_visited_count += 1;
  }

  return summary;
}

export default async function MobileSearchSitePage({
  params
}: {
  params: { incidentId: string; siteId: string };
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [
    { data: site, error: siteError },
    { data: floorRows, error: floorsError },
    { data: unitRows, error: unitsError },
    { data: searchRows },
    { data: canEditSearch }
  ] = await Promise.all([
    supabase
      .from("sites")
      .select("id,incident_id,name,city,street,house_number,search_status")
      .eq("incident_id", params.incidentId)
      .eq("id", params.siteId)
      .eq("site_type", "search_site")
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("floors")
      .select("id,floor_number,is_active")
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId)
      .eq("is_active", true)
      .order("floor_number", { ascending: false }),
    supabase
      .from("units")
      .select("id,floor_id,unit_number,zone_name,zone_type,zone_sequence,is_active")
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId)
      .eq("is_active", true)
      .order("unit_number", { ascending: true }),
    supabase
      .from("site_search_units")
      .select("unit_id,family_name,occupants_count,contact_phone,search_status,casualty_psych,casualty_body,medical_evacuation,anxiety_casualties_count,physical_casualties_count,has_apartment_damage,apartment_damage_notes,notes")
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId),
    supabase.rpc("can_edit_search_site_data", { p_incident_id: params.incidentId })
  ]);

  if (siteError || !site) {
    notFound();
  }

  if (floorsError || unitsError) {
    throw new Error(floorsError?.message ?? unitsError?.message ?? "לא ניתן לטעון אתר סריקה");
  }

  const searchResultsByUnit = new Map(
    ((searchRows ?? []) as MobileSearchResult[]).map((result) => [result.unit_id, result])
  );
  const units = (unitRows ?? []) as MobileSearchUnit[];
  const unitsByFloor = units.reduce<Map<string, MobileSearchUnit[]>>((grouped, unit) => {
    const floorUnits = grouped.get(unit.floor_id) ?? [];
    floorUnits.push(unit);
    grouped.set(unit.floor_id, floorUnits);
    return grouped;
  }, new Map());
  const liveSummary = liveSummaryFromRows(units, searchResultsByUnit);

  return (
    <MobileSearchScanner
      site={site as MobileSearchSite}
      floors={(floorRows ?? []) as MobileSearchFloor[]}
      unitsByFloor={unitsByFloor}
      searchResultsByUnit={searchResultsByUnit}
      summary={liveSummary}
      canEdit={Boolean(canEditSearch)}
      reporterName={userDisplayName(user)}
    />
  );
}
