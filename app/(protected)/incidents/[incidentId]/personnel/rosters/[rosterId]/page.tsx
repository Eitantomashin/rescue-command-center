import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getVehicleRosterForIncident, listRosterEligiblePeople } from "../../actions";
import { VehicleRosterDetailClient } from "./roster-detail-client";
import { numberValue, type EligibleRosterPerson, type SiteOption, type VehicleRosterDetail } from "../roster-types";

export default async function VehicleRosterDetailPage({
  params
}: {
  params: { incidentId: string; rosterId: string };
}) {
  const supabase = createClient();
  const [{ data: canEditPersonnel }, { data: sites }, rosterData, eligibleData] = await Promise.all([
    supabase.rpc("can_edit_personnel", { p_incident_id: params.incidentId }),
    supabase.from("sites").select("id,name").eq("incident_id", params.incidentId).order("name", { ascending: true }),
    getVehicleRosterForIncident(params.incidentId, params.rosterId),
    listRosterEligiblePeople(params.incidentId, params.rosterId)
  ]);

  if (!rosterData) {
    return (
      <section className="empty-state-card" dir="rtl">
        <h1>השבצ"ק לא נמצא</h1>
        <p>ייתכן שהשבצ"ק נמחק או שאין לך הרשאת צפייה.</p>
        <Link className="button secondary" href={`/incidents/${params.incidentId}/personnel/rosters`}>חזרה לשבצ"קים</Link>
      </section>
    );
  }

  const roster = rosterData as VehicleRosterDetail;
  roster.participants = Array.isArray(roster.participants) ? roster.participants : [];
  roster.participant_count = numberValue(roster.participant_count);

  return (
    <VehicleRosterDetailClient
      incidentId={params.incidentId}
      roster={roster}
      eligiblePeople={(eligibleData ?? []) as EligibleRosterPerson[]}
      sites={(sites ?? []) as SiteOption[]}
      canEditPersonnel={Boolean(canEditPersonnel)}
    />
  );
}