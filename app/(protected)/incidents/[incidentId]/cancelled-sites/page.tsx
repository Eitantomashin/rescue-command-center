import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { siteTypeLabel } from "@/lib/site-display";
import { restoreCancelledSiteAction } from "./actions";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";

type CancelledSiteRow = {
  id: string;
  site_number: number;
  name: string | null;
  site_type: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

function siteDisplayName(site: CancelledSiteRow) {
  return site.name?.trim() || `אתר ${site.site_number}`;
}

function siteAddress(site: CancelledSiteRow) {
  return [site.street, site.house_number, site.city].filter(Boolean).join(" ");
}

export default async function CancelledSitesPage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const [{ data: role }, { data: incident }] = await Promise.all([
    supabase.rpc("current_user_role"),
    supabase.from("incidents").select("id,name").eq("id", params.incidentId).maybeSingle()
  ]);

  if (role !== "admin" || !incident) {
    notFound();
  }

  const { data: cancelledSites, error } = await supabase
    .from("sites")
    .select("id,site_number,name,site_type,city,street,house_number,cancelled_at,cancelled_by,cancellation_reason")
    .eq("incident_id", params.incidentId)
    .eq("is_cancelled", true)
    .order("cancelled_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(error.message);
  }

  const sites = (cancelledSites ?? []) as CancelledSiteRow[];
  const actorIds = Array.from(new Set(sites.map((site) => site.cancelled_by).filter(Boolean) as string[]));
  const { data: profileRows } =
    actorIds.length > 0
      ? await supabase.from("profiles").select("id,display_name").in("id", actorIds)
      : { data: [] };
  const profiles = new Map(((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile.display_name]));

  return (
    <main className="page cancelled-sites-page">
      <div className="header">
        <div>
          <h1>אתרים שבוטלו</h1>
          <p className="muted">{incident.name}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" href={`/incidents/${params.incidentId}/sites`}>
            כל האתרים
          </Link>
          <Link className="button secondary" href={`/incidents/${params.incidentId}`}>
            דשבורד אירוע
          </Link>
        </div>
      </div>

      <section className="panel">
        {sites.length === 0 ? (
          <p className="muted">אין אתרים שבוטלו באירוע זה.</p>
        ) : (
          <table className="table cancelled-sites-table">
            <thead>
              <tr>
                <th>אתר</th>
                <th>סוג אתר</th>
                <th>כתובת</th>
                <th>תאריך ביטול</th>
                <th>בוטל על ידי</th>
                <th>סיבה</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.id} className="cancelled-site-row">
                  <td>
                    <span className="muted-badge">בוטל</span>
                    <strong>{siteDisplayName(site)}</strong>
                    <div className="muted">אתר {site.site_number}</div>
                  </td>
                  <td>{siteTypeLabel(site.site_type)}</td>
                  <td>{siteAddress(site) || "-"}</td>
                  <td>{site.cancelled_at ? formatDateTime(site.cancelled_at) : "-"}</td>
                  <td>{site.cancelled_by ? profiles.get(site.cancelled_by) ?? site.cancelled_by : "-"}</td>
                  <td>{site.cancellation_reason ?? "-"}</td>
                  <td>
                    <details className="inline-confirm-panel">
                      <summary className="button secondary">החזר לפעילות</summary>
                      <form action={restoreCancelledSiteAction} className="action-form">
                        <input type="hidden" name="incidentId" value={params.incidentId} />
                        <input type="hidden" name="siteId" value={site.id} />
                        <p className="warning-text">
                          האם להחזיר את האתר לפעילות? האתר יחזור לדשבורדים, לחישובים ולמסכי הניהול.
                        </p>
                        <OperationalLoadingButton className="button secondary" label={"\u05d0\u05e9\u05e8 \u05e9\u05d7\u05d6\u05d5\u05e8"} loadingLabel={"\u05de\u05e9\u05d7\u05d6\u05e8..."} />
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
