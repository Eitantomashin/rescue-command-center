import Link from "next/link";
import { IncidentCreationWizard } from "./incident-creation-wizard";

export default function NewIncidentPage() {
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
