import { createClient } from "@/lib/supabase/server";
import { listVehicleRostersForIncident } from "../actions";
import { VehicleRosterListClient } from "./roster-list-client";
import { numberValue, type VehicleRosterListRow } from "./roster-types";

export default async function VehicleRostersPage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const [{ data: canEditPersonnel }, rosterData] = await Promise.all([
    supabase.rpc("can_edit_personnel", { p_incident_id: params.incidentId }),
    listVehicleRostersForIncident(params.incidentId)
  ]);

  const rosters = (rosterData as VehicleRosterListRow[]).map((row) => ({
    ...row,
    participant_count: numberValue(row.participant_count)
  }));

  return (
    <VehicleRosterListClient
      incidentId={params.incidentId}
      rosters={rosters}
      canEditPersonnel={Boolean(canEditPersonnel)}
    />
  );
}