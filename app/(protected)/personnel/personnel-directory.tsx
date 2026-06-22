"use client";

import { useMemo, useState } from "react";
import { PersonnelActivityForm, PersonnelEditForm } from "./personnel-forms";
import {
  PERSONNEL_DEPARTMENTS,
  PERSONNEL_ROLES,
  personnelDepartmentLabel,
  personnelRoleLabel
} from "./personnel-options";

export type PersonnelDirectoryRow = {
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

type FormAction = (formData: FormData) => void | Promise<void>;

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueCustomOptions(rows: PersonnelDirectoryRow[], field: "role" | "department") {
  const values = new Set<string>();
  for (const row of rows) {
    const customValue = field === "role" ? row.role_other : row.department_other;
    if (row[field] === "other" && customValue?.trim()) {
      values.add(customValue.trim());
    }
  }

  return Array.from(values).sort((a, b) => a.localeCompare(b, "he"));
}

function personnelMatches(row: PersonnelDirectoryRow, query: string, department: string, role: string) {
  const fullName = `${row.first_name} ${row.last_name}`;
  const roleLabel = personnelRoleLabel(row.role, row.role_other);
  const departmentLabel = personnelDepartmentLabel(row.department, row.department_other);
  const searchText = normalize(`${fullName} ${row.mobile_phone ?? ""}`);
  const normalizedQuery = normalize(query);

  if (normalizedQuery && !searchText.includes(normalizedQuery)) {
    return false;
  }

  if (department) {
    const matchesDepartment =
      row.department === department ||
      normalize(departmentLabel) === normalize(department) ||
      normalize(row.department_other) === normalize(department);
    if (!matchesDepartment) {
      return false;
    }
  }

  if (role) {
    const matchesRole =
      row.role === role ||
      normalize(roleLabel) === normalize(role) ||
      normalize(row.role_other) === normalize(role);
    if (!matchesRole) {
      return false;
    }
  }

  return true;
}

export function PersonnelDirectory({
  personnel,
  updateAction,
  canEdit
}: {
  personnel: PersonnelDirectoryRow[];
  updateAction: FormAction;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const customDepartments = useMemo(() => uniqueCustomOptions(personnel, "department"), [personnel]);
  const customRoles = useMemo(() => uniqueCustomOptions(personnel, "role"), [personnel]);

  const filteredPersonnel = useMemo(
    () => personnel.filter((person) => personnelMatches(person, query, department, role)),
    [department, personnel, query, role]
  );
  const activePersonnel = filteredPersonnel.filter((person) => person.is_active);
  const inactivePersonnel = filteredPersonnel.filter((person) => !person.is_active);

  function renderPersonnelList(rows: PersonnelDirectoryRow[], emptyText: string) {
    if (rows.length === 0) {
      return <p className="muted">{emptyText}</p>;
    }

    return (
      <div className="personnel-roster-list">
        {rows.map((person) => (
          <div className="personnel-roster-entry" key={person.id}>
            {canEdit ? (
              <PersonnelEditForm action={updateAction} person={person} />
            ) : (
              <div className="personnel-readonly-row">
                <strong>{person.first_name} {person.last_name}</strong>
                <span>{person.mobile_phone ?? "-"}</span>
              </div>
            )}
            <div className="personnel-roster-meta">
              <span className="muted">
                {personnelDepartmentLabel(person.department, person.department_other)} · {personnelRoleLabel(person.role, person.role_other)}
              </span>
              {canEdit ? <PersonnelActivityForm action={updateAction} person={person} /> : null}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <section className="panel personnel-filter-panel">
        <div className="section-title-row">
          <div>
            <h2>חיפוש וסינון</h2>
            <p className="muted">
              נמצאו {filteredPersonnel.length} מתוך {personnel.length} אנשי כ״א
            </p>
          </div>
          <button
            className="button compact secondary"
            type="button"
            onClick={() => {
              setQuery("");
              setDepartment("");
              setRole("");
            }}
          >
            נקה סינון
          </button>
        </div>

        <div className="log-filter-grid personnel-filter-grid">
          <label>
            חיפוש חופשי
            <input
              className="input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="שם פרטי, שם משפחה או טלפון"
            />
          </label>
          <label>
            מחלקה
            <select className="input" value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="">כל המחלקות</option>
              {PERSONNEL_DEPARTMENTS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
              {customDepartments.map((customDepartment) => (
                <option key={customDepartment} value={customDepartment}>
                  {customDepartment}
                </option>
              ))}
            </select>
          </label>
          <label>
            תפקיד
            <select className="input" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="">כל התפקידים</option>
              {PERSONNEL_ROLES.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
              {customRoles.map((customRole) => (
                <option key={customRole} value={customRole}>
                  {customRole}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="section-title-row">
          <h2>כ״א פעיל</h2>
          <span className="status-pill success">{activePersonnel.length}</span>
        </div>
        {renderPersonnelList(activePersonnel, "לא נמצא כ״א פעיל לפי הסינון הנוכחי.")}
      </section>

      <section className="panel">
        <div className="section-title-row">
          <h2>עוזבי היחידה</h2>
          <span className="status-pill neutral">{inactivePersonnel.length}</span>
        </div>
        {renderPersonnelList(inactivePersonnel, "לא נמצאו עוזבי יחידה לפי הסינון הנוכחי.")}
      </section>
    </>
  );
}
