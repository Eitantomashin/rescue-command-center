import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IncidentCreationWizard } from "./incident-creation-wizard";

export default async function NewIncidentPage() {
  const supabase = createClient();
  const { data: canManage } = await supabase.rpc("can_manage_incidents");

  if (!canManage) {
    notFound();
  }

  return (
    <main className="page wizard-page">
      <div className="header">
        <div>
          <h1>פתיחת אירוע חדש</h1>
          <p className="muted">פתיחה מהירה של אירוע מבצעי. אתרים יוקמו בשלב הבא.</p>
        </div>
        <Link className="button secondary" href="/incidents">
          חזרה לרשימת אירועים
        </Link>
      </div>

      <IncidentCreationWizard />
    </main>
  );
}
