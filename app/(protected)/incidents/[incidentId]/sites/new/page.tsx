import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteCreationWizard } from "./site-creation-wizard";

export default async function NewSitePage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const [{ data: incident, error }, { data: canManageSites }] = await Promise.all([
    supabase
      .from("incidents")
      .select("id,name")
      .eq("id", params.incidentId)
      .maybeSingle(),
    supabase.rpc("can_manage_sites", { p_incident_id: params.incidentId })
  ]);

  if (error || !incident || !canManageSites) {
    notFound();
  }

  return (
    <main className="page wizard-page">
      <div className="header">
        <div>
          <h1>אשף הקמת אתר</h1>
          <p className="muted">{incident.name}</p>
        </div>
        <Link className="button secondary" href={`/incidents/${params.incidentId}/sites`}>
          חזרה לאתרים
        </Link>
      </div>

      <SiteCreationWizard incidentId={params.incidentId} incidentName={incident.name ?? "אירוע"} />
    </main>
  );
}
