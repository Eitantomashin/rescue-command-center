import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InvestigationAssistant } from "./investigation-assistant";

export default async function InvestigationAssistantPage({ params }: { params: { incidentId: string } }) {
  const supabase = createClient();
  const [{ data: incident }, { data: canView }] = await Promise.all([
    supabase.from("incidents").select("id,name").eq("id", params.incidentId).maybeSingle(),
    supabase.rpc("can_view_incident", { p_incident_id: params.incidentId })
  ]);
  if (!incident || !canView) notFound();

  return <main className="page investigation-assistant-page">
    <div className="header"><div><p className="eyebrow">{incident.name}</p><h1>עוזר תחקור</h1><p className="muted">שאילת שאלות עובדתיות על בסיס ציר הזמן, חיתוכי המצב והמידע המבצעי של האירוע בלבד.</p></div></div>
    <InvestigationAssistant incidentId={params.incidentId} />
  </main>;
}
