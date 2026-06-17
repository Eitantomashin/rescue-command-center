import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { uploadSiteGridImage } from "./actions";
import { SiteGridMap, type GridMarker } from "./site-grid-map";

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
  const { data: operationalRows } = await supabase
    .from("operational_numbers_dashboard")
    .select(
      "person_id,operational_number,team_number,first_name,last_name,resident_first_name,resident_last_name,dashboard_status_group,dashboard_card_color,dashboard_status_label,current_status_label,latest_report_status_label,latest_grid_cell,latest_reported_at,is_merged"
    )
    .eq("incident_id", params.incidentId)
    .eq("site_id", params.siteId)
    .eq("is_merged", false)
    .order("operational_number", { ascending: true });

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

  return (
    <main className="page site-grid-map-page">
      <div className="header">
        <div>
          <p className="eyebrow">ריכוז פעילות מול תא שטח</p>
          <h1>{siteTitle(site)}</h1>
          <p className="muted">תמונת אתר עם גריד פעילות וסמנים מתוך המספרים המבצעיים הקיימים.</p>
        </div>
      </div>

      <section className="panel site-grid-upload-panel">
        <div>
          <h2>תמונת אתר</h2>
          <p className="muted">
            {site.image_name ? `תמונה פעילה: ${site.image_name}` : "העלה תמונת רחפן, אוויר או סקירת אתר."}
          </p>
        </div>
        <form action={uploadSiteGridImage} className="site-grid-upload-form">
          <input type="hidden" name="incidentId" value={params.incidentId} />
          <input type="hidden" name="siteId" value={params.siteId} />
          <input className="input" type="file" name="siteImage" accept="image/png,image/jpeg,image/webp" required />
          <button className="button" type="submit">
            העלה תמונה
          </button>
        </form>
      </section>

      <SiteGridMap imageUrl={imageUrl} markers={markers} />
    </main>
  );
}
