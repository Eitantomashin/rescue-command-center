import { createClient } from "@/lib/supabase/server";
import { createUnitPersonnel, importUnitPersonnel, updateUnitPersonnel } from "./actions";
import { PersonnelActivityForm, PersonnelCreateForm, PersonnelEditForm, PersonnelImportForm } from "./personnel-forms";
import { personnelDepartmentLabel, personnelRoleLabel } from "./personnel-options";

type PersonnelRow = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  role_other: string | null;
  department: string;
  department_other: string | null;
  mobile_phone: string | null;
  is_active: boolean;
};

function queryValue(searchParams: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function PersonnelPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("unit_personnel")
    .select("id,first_name,last_name,role,role_other,department,department_other,mobile_phone,is_active")
    .order("is_active", { ascending: false })
    .order("department", { ascending: true })
    .order("last_name", { ascending: true });

  const personnel = (data ?? []) as PersonnelRow[];
  const activePersonnel = personnel.filter((person) => person.is_active);
  const inactivePersonnel = personnel.filter((person) => !person.is_active);

  function renderPersonnelList(rows: PersonnelRow[], emptyText: string) {
    if (rows.length === 0) {
      return <p className="muted">{emptyText}</p>;
    }

    return (
      <div className="personnel-roster-list">
        {rows.map((person) => (
          <div className="personnel-roster-entry" key={person.id}>
            <PersonnelEditForm action={updateUnitPersonnel} person={person} />
            <div className="personnel-roster-meta">
              <span className="muted">
                {personnelDepartmentLabel(person.department, person.department_other)} · {personnelRoleLabel(person.role, person.role_other)}
              </span>
              <PersonnelActivityForm action={updateUnitPersonnel} person={person} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <main className="page personnel-page">
      <div className="header">
        <div>
          <p className="eyebrow">כ&quot;א יחידתי</p>
          <h1>פתיחה/עדכון כ&quot;א יחידתי</h1>
          <p className="muted">רשימת המאסטר של אנשי היחידה. סטטוס נוכחות באירוע מנוהל בנפרד לכל אירוע.</p>
        </div>
      </div>

      {error ? (
        <section className="panel">
          <p className="error">לא ניתן לטעון כ&quot;א: {error.message}</p>
        </section>
      ) : null}

      {queryValue(searchParams, "created") ? (
        <section className="panel success-panel">
          <p>איש הצוות נוסף בהצלחה.</p>
        </section>
      ) : null}

      {queryValue(searchParams, "duplicate") ? (
        <section className="panel warning-panel">
          <p>האדם כבר קיים ברשימת כ&quot;א.</p>
        </section>
      ) : null}

      {queryValue(searchParams, "imported") ? (
        <section className="panel import-summary-panel">
          <h2>סיכום ייבוא</h2>
          <div className="import-summary-grid">
            <span>נוספו: <strong>{queryValue(searchParams, "added") ?? "0"}</strong></span>
            <span>עודכנו: <strong>{queryValue(searchParams, "updated") ?? "0"}</strong></span>
            <span>דולגו ככפולים: <strong>{queryValue(searchParams, "skipped") ?? "0"}</strong></span>
            <span>שגויים: <strong>{queryValue(searchParams, "invalid") ?? "0"}</strong></span>
            <span>שורת כותרות: <strong>{queryValue(searchParams, "headerRow") ?? "-"}</strong></span>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>הוספת איש צוות</h2>
        <PersonnelCreateForm action={createUnitPersonnel} />
      </section>

      <section className="panel">
        <div className="section-title-row">
          <div>
            <h2>ייבוא מאקסל</h2>
            <p className="muted">עמודות נדרשות: שם פרטי, שם משפחה, תפקיד, מחלקה, טלפון נייד.</p>
          </div>
        </div>
        <PersonnelImportForm action={importUnitPersonnel} />
      </section>

      <section className="panel">
        <div className="section-title-row">
          <h2>כ&quot;א פעיל</h2>
          <span className="status-pill success">{activePersonnel.length}</span>
        </div>
        {renderPersonnelList(activePersonnel, "לא הוגדר עדיין כ\"א פעיל.")}
      </section>

      <section className="panel">
        <div className="section-title-row">
          <h2>עוזבי היחידה</h2>
          <span className="status-pill neutral">{inactivePersonnel.length}</span>
        </div>
        {renderPersonnelList(inactivePersonnel, "אין כרגע אנשי כ\"א ברשימת עוזבי היחידה.")}
      </section>
    </main>
  );
}
