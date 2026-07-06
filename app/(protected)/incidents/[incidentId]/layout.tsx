import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IncidentCommandShell } from "./incident-command-shell";
import { IncidentPresenceProvider } from "./incident-presence";
import { RealtimeRefresh } from "./realtime-refresh";

type IncidentRow = {
  id: string;
  name: string;
  is_closed: boolean;
};

type SiteRow = {
  site_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  updated_potential: number;
  active_operational_numbers_count?: number | null;
  gap_resolved_count?: number | null;
  operational_gap: number;
  site_type?: string | null;
  search_status?: string | null;
};

type SummaryRow = {
  updated_potential: number;
  active_operational_numbers_count?: number | null;
  gap_resolved_count?: number | null;
  operational_gap: number;
  total_sites?: number | null;
  active_teams?: number | null;
  operational_numbers_rescued_count?: number | null;
  operational_numbers_evacuated_count?: number | null;
  operational_numbers_located_outside_site_count?: number | null;
  operational_numbers_deceased_count?: number | null;
};

export default async function IncidentLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const [
    {
      data: { user }
    },
    { data: incident, error: incidentError },
    { data: sites },
    { data: siteMetadataRows },
    { data: summary },
    { data: currentRole }
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("incidents").select("id,name,is_closed").eq("id", params.incidentId).maybeSingle(),
    supabase
      .from("site_dashboard_summary")
      .select("site_id,site_number,name,city,street,house_number,updated_potential,active_operational_numbers_count,gap_resolved_count,operational_gap")
      .eq("incident_id", params.incidentId)
      .order("site_number", { ascending: true }),
    supabase
      .from("sites")
      .select("id,site_number,name,city,street,house_number,site_type,search_status")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true),
    supabase
      .from("incident_dashboard_summary")
      .select("updated_potential,active_operational_numbers_count,gap_resolved_count,operational_gap,total_sites,active_teams,operational_numbers_rescued_count,operational_numbers_evacuated_count,operational_numbers_located_outside_site_count,operational_numbers_deceased_count")
      .eq("incident_id", params.incidentId)
      .maybeSingle(),
    supabase.rpc("current_user_role")
  ]);

  if (incidentError || !incident) {
    notFound();
  }

  const siteMetadataRowsTyped = (siteMetadataRows ?? []) as Array<{
    id: string;
    site_number: number;
    name: string | null;
    city: string | null;
    street: string | null;
    house_number: string | null;
    site_type: string | null;
    search_status: string | null;
  }>;
  const siteMetadata = new Map(siteMetadataRowsTyped.map((site) => [site.id, site]));
  const isSearchUser = currentRole === "search_user";
  const searchUserSites: SiteRow[] = siteMetadataRowsTyped
    .filter((site) => site.site_type === "search_site")
    .map((site) => ({
      site_id: site.id,
      site_number: site.site_number,
      name: site.name,
      city: site.city,
      street: site.street,
      house_number: site.house_number,
      updated_potential: 0,
      active_operational_numbers_count: 0,
      gap_resolved_count: 0,
      operational_gap: 0,
      site_type: site.site_type,
      search_status: site.search_status
    }));
  const shellSites = isSearchUser
    ? searchUserSites
    : ((sites ?? []) as SiteRow[]).map((site) => ({
        ...site,
        site_type: siteMetadata.get(site.site_id)?.site_type ?? "rescue_site",
        search_status: siteMetadata.get(site.site_id)?.search_status ?? null
      }));

  return (
    <IncidentPresenceProvider
      incidentId={params.incidentId}
      user={{
        id: user?.id ?? "unknown",
        email: user?.email ?? null,
        user_metadata: user?.user_metadata
      }}
      sites={shellSites}
    >
      <IncidentCommandShell
        incident={incident as IncidentRow}
        sites={shellSites}
        summary={
          (summary as SummaryRow | null) ?? {
            updated_potential: 0,
            active_operational_numbers_count: 0,
            gap_resolved_count: 0,
            operational_gap: 0,
            total_sites: 0,
            active_teams: 0,
            operational_numbers_rescued_count: 0,
            operational_numbers_evacuated_count: 0,
            operational_numbers_located_outside_site_count: 0,
            operational_numbers_deceased_count: 0
          }
        }
        systemRole={typeof currentRole === "string" ? currentRole : null}
      >
        <RealtimeRefresh incidentId={params.incidentId} />
        {children}
      </IncidentCommandShell>
    </IncidentPresenceProvider>
  );
}
