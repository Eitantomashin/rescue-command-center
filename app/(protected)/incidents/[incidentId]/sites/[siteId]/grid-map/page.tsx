import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScreenPresenceIndicator } from "../../../incident-presence";
import { uploadSiteGridImage } from "./actions";
import { SiteGridMap, type GridMarker, type MapObject, type MapTeam } from "./site-grid-map";

type SiteRow = {
  id: string;
  incident_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string;
  house_number: string;
  image_name: string | null;
  image_data_url: string | null;
};

type OperationalNumberRow = {
  person_id: string;
  operational_number: number;
  team_number: number | null;
  first_name: string | null;
  last_name: string | null;
  resident_first_name: string | null;
  resident_last_name: string | null;
  dashboard_status_group: string | null;
  dashboard_card_color: string | null;
  dashboard_status_label: string | null;
  current_status_label: string | null;
  latest_report_status_label: string | null;
  latest_grid_cell: string | null;
  latest_reported_at: string | null;
  is_merged: boolean;
};

type MapObjectRow = {
  id: string;
  object_type: "sector" | "entry_point" | "route";
  name: string;
  assigned_team_number: number | null;
  color: string | null;
  operational_status: string | null;
  notes: string | null;
  geometry: Record<string, unknown>;
  is_active: boolean;
};

type TeamRow = {
  team_number: number;
  name: string | null;
};

function siteTitle(site: SiteRow) {
  return site.name?.trim() || `${site.street} ${site.house_number}`.trim() || `אתר ${site.site_number}`;
}

function personName(row: OperationalNumberRow) {
  const person = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  if (person) {
    return person;
  }

  const resident = [row.resident_first_name, row.resident_last_name].filter(Boolean).join(" ").trim();
  return resident || null;
}

async function imageUrlFromReference(reference: string | null, supabase: ReturnType<typeof createClient>) {
  if (!reference) {
    return null;
  }

  if (reference.startsWith("storage:")) {
    const storageReference = reference.slice("storage:".length);
    const [bucket, ...pathParts] = storageReference.split("/");
    const path = pathParts.join("/");

    if (!bucket || !path) {
      return null;
    }

    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
    return data?.signedUrl ?? null;
  }

  return reference;
}

export default async function SiteGridMapPage({
  params
}: {
  params: { incidentId: string; siteId: string };
}) {
  const supabase = createClient();
  const { data: siteData, error: siteError } = await supabase
    .from("sites")
    .select("id,incident_id,site_number,name,city,street,house_number,image_name,image_data_url")
    .eq("incident_id", params.incidentId)
    .eq("id", params.siteId)
    .maybeSingle();

  if (siteError || !siteData) {
    notFound();
  }

  const site = siteData as SiteRow;
  const imageUrl = await imageUrlFromReference(site.image_data_url, supabase);
  const [
    { data: operationalRows },
    { data: mapObjectRows },
    { data: teamRows },
    { data: canEditOperational },
    { data: canManageSites }
  ] = await Promise.all([
    supabase
      .from("operational_numbers_dashboard")
      .select(
        "person_id,operational_number,team_number,first_name,last_name,resident_first_name,resident_last_name,dashboard_status_group,dashboard_card_color,dashboard_status_label,current_status_label,latest_report_status_label,latest_grid_cell,latest_reported_at,is_merged"
      )
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId)
      .eq("is_merged", false)
      .order("operational_number", { ascending: true }),
    supabase
      .from("site_map_objects")
      .select("id,object_type,name,assigned_team_number,color,operational_status,notes,geometry,is_active")
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("teams")
      .select("team_number,name")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
      .order("team_number", { ascending: true }),
    supabase.rpc("can_edit_operational_data", { p_incident_id: params.incidentId }),
    supabase.rpc("can_manage_sites", { p_incident_id: params.incidentId })
  ]);

  const markers: GridMarker[] = ((operationalRows ?? []) as OperationalNumberRow[]).map((row) => ({
    personId: row.person_id,
    operationalNumber: row.operational_number,
    personName: personName(row),
    statusLabel: row.latest_report_status_label ?? row.dashboard_status_label ?? row.current_status_label,
    statusGroup: row.dashboard_status_group,
    cardColor: row.dashboard_card_color,
    latestReportedAt: row.latest_reported_at,
    teamNumber: row.team_number,
    gridCell: row.latest_grid_cell
  }));
  const mapObjects: MapObject[] = ((mapObjectRows ?? []) as MapObjectRow[]).map((row) => ({
    id: row.id,
    objectType: row.object_type,
    name: row.name,
    assignedTeamNumber: row.assigned_team_number,
    color: row.color,
    operationalStatus: row.operational_status,
    notes: row.notes,
    geometry: row.geometry
  }));
  const teamsByNumber = new Map<number, MapTeam>();
  for (const teamNumber of [1, 2, 3, 4, 9]) {
    teamsByNumber.set(teamNumber, {
      teamNumber,
      label: teamNumber === 9 ? "צוות אוכלוסייה" : `צוות ${teamNumber}`
    });
  }

  for (const team of (teamRows ?? []) as TeamRow[]) {
    teamsByNumber.set(team.team_number, {
      teamNumber: team.team_number,
      label: team.name?.trim() || (team.team_number === 9 ? "צוות אוכלוסייה" : `צוות ${team.team_number}`)
    });
  }

  const teams = Array.from(teamsByNumber.values()).sort((a, b) => a.teamNumber - b.teamNumber);

  return (
    <main className="page site-grid-map-page">
      <div className="header">
        <div>
          <p className="eyebrow">ריכוז פעילות מול תא שטח</p>
          <h1>{siteTitle(site)}</h1>
          <p className="muted">תמונת אתר עם גריד פעילות וסמנים מתוך המספרים המבצעיים הקיימים.</p>
        </div>
      </div>
      <ScreenPresenceIndicator />

      <section className="panel site-grid-upload-panel">
        <div>
          <h2>תמונת אתר</h2>
          <p className="muted">
            {site.image_name ? `תמונה פעילה: ${site.image_name}` : "העלה תמונת רחפן, אוויר או סקירת אתר."}
          </p>
        </div>
        {canManageSites ? <form action={uploadSiteGridImage} className="site-grid-upload-form">
          <input type="hidden" name="incidentId" value={params.incidentId} />
          <input type="hidden" name="siteId" value={params.siteId} />
          <input className="input" type="file" name="siteImage" accept="image/png,image/jpeg,image/webp" required />
          <button className="button" type="submit">
            העלה תמונה
          </button>
        </form> : null}
      </section>

      <SiteGridMap
        incidentId={params.incidentId}
        siteId={params.siteId}
        siteName={siteTitle(site)}
        imageUrl={imageUrl}
        markers={markers}
        mapObjects={mapObjects}
        teams={teams}
        canEdit={Boolean(canEditOperational)}
      />
    </main>
  );
}
