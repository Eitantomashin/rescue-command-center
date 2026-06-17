import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IncidentCommandShell } from "./incident-command-shell";

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
  const [{ data: incident, error: incidentError }, { data: sites }, { data: summary }] = await Promise.all([
    supabase.from("incidents").select("id,name,is_closed").eq("id", params.incidentId).maybeSingle(),
    supabase
      .from("site_dashboard_summary")
      .select("site_id,site_number,name,city,street,house_number,updated_potential,active_operational_numbers_count,gap_resolved_count,operational_gap")
      .eq("incident_id", params.incidentId)
      .order("site_number", { ascending: true }),
    supabase
      .from("incident_dashboard_summary")
      .select("updated_potential,active_operational_numbers_count,gap_resolved_count,operational_gap,total_sites,active_teams,operational_numbers_rescued_count,operational_numbers_evacuated_count,operational_numbers_located_outside_site_count,operational_numbers_deceased_count")
      .eq("incident_id", params.incidentId)
      .maybeSingle()
  ]);

  if (incidentError || !incident) {
    notFound();
  }

  return (
    <IncidentCommandShell
      incident={incident as IncidentRow}
      sites={(sites ?? []) as SiteRow[]}
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
    >
      {children}
    </IncidentCommandShell>
  );
}
