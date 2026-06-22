import { redirect } from "next/navigation";

export default function NewSituationReportPage({ params }: { params: { incidentId: string } }) {
  redirect(`/incidents/${params.incidentId}/sitreps`);
}
