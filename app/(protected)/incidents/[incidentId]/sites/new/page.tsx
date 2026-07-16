import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteCreationWizard } from "./site-creation-wizard";

type ParentSiteOption = {
  site_id: string;
  site_number: number;
  name: string | null;
  street: string | null;
  house_number: string | null;
  city: string | null;
};

export default async function NewSitePage({
  params,
  searchParams
}: {
  params: { incidentId: string };
  searchParams?: { siteCreate?: string };
}) {
  const supabase = createClient();
  const [{ data: incident, error }, { data: canManageSites }, { data: parentSiteRows }] = await Promise.all([
    supabase
      .from("incidents")
      .select("id,name")
      .eq("id", params.incidentId)
      .maybeSingle(),
    supabase.rpc("can_manage_sites", { p_incident_id: params.incidentId }),
    supabase
      .from("sites")
      .select("site_id:id,site_number,name,street,house_number,city")
      .eq("incident_id", params.incidentId)
      .eq("site_type", "rescue_site")
      .eq("is_active", true)
      .order("site_number", { ascending: true })
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

      {searchParams?.siteCreate === "error" ? (
        <section className="panel">
          <p className="error">לא ניתן היה ליצור את האתר. בדוק הרשאות ונסה שוב.</p>
        </section>
      ) : null}

      <SiteCreationWizard
        incidentId={params.incidentId}
        incidentName={incident.name ?? "אירוע"}
        parentSites={(parentSiteRows ?? []) as ParentSiteOption[]}
      />
    </main>
  );
}
