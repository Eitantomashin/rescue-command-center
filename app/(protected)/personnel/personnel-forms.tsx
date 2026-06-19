"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { PERSONNEL_DEPARTMENTS, PERSONNEL_ROLES } from "./personnel-options";

type PersonnelRecord = {
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

function Options({ options }: { options: readonly (readonly [string, string])[] }) {
  return (
    <>
      {options.map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </>
  );
}

function SubmitButton({
  children,
  className = "button",
  pendingText = "שומר..."
}: {
  children: ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

export function PersonnelCreateForm({ action }: { action: FormAction }) {
  const [role, setRole] = useState("rescuer");
  const [department, setDepartment] = useState("team_1");

  return (
    <form action={action} className="form-grid personnel-form">
      <input className="input" name="firstName" placeholder="שם פרטי" required />
      <input className="input" name="lastName" placeholder="שם משפחה" required />
      <select className="input" name="role" required value={role} onChange={(event) => setRole(event.target.value)}>
        <Options options={PERSONNEL_ROLES} />
      </select>
      {role === "other" ? <input className="input" name="roleOther" placeholder="תפקיד אחר" required /> : null}
      <select
        className="input"
        name="department"
        required
        value={department}
        onChange={(event) => setDepartment(event.target.value)}
      >
        <Options options={PERSONNEL_DEPARTMENTS} />
      </select>
      {department === "other" ? <input className="input" name="departmentOther" placeholder="מחלקה אחרת" required /> : null}
      <input className="input" name="mobilePhone" placeholder="טלפון נייד" />
      <SubmitButton>הוסף</SubmitButton>
    </form>
  );
}

export function PersonnelEditForm({
  action,
  person
}: {
  action: FormAction;
  person: PersonnelRecord;
}) {
  const [role, setRole] = useState(person.role);
  const [department, setDepartment] = useState(person.department);

  return (
    <form action={action} className={`personnel-roster-row${person.is_active ? "" : " inactive"}`}>
      <input type="hidden" name="personnelId" value={person.id} />
      <input className="input" name="firstName" defaultValue={person.first_name} required />
      <input className="input" name="lastName" defaultValue={person.last_name} required />
      <select className="input" name="role" value={role} onChange={(event) => setRole(event.target.value)}>
        <Options options={PERSONNEL_ROLES} />
      </select>
      {role === "other" ? <input className="input" name="roleOther" defaultValue={person.role_other ?? ""} placeholder="תפקיד אחר" required /> : null}
      <select className="input" name="department" value={department} onChange={(event) => setDepartment(event.target.value)}>
        <Options options={PERSONNEL_DEPARTMENTS} />
      </select>
      {department === "other" ? (
        <input className="input" name="departmentOther" defaultValue={person.department_other ?? ""} placeholder="מחלקה אחרת" required />
      ) : null}
      <input className="input" name="mobilePhone" defaultValue={person.mobile_phone ?? ""} placeholder="טלפון" />
      <input type="hidden" name="isActive" value={person.is_active ? "true" : "false"} />
      <SubmitButton className="button secondary">שמור</SubmitButton>
    </form>
  );
}

export function PersonnelActivityForm({
  action,
  person
}: {
  action: FormAction;
  person: PersonnelRecord;
}) {
  const targetActive = !person.is_active;

  return (
    <form
      action={action}
      className="personnel-activity-form"
      onSubmit={(event) => {
        if (!targetActive && !window.confirm("האם להעביר את איש כ״א לרשימת עוזבי היחידה?")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="personnelId" value={person.id} />
      <input type="hidden" name="firstName" value={person.first_name} />
      <input type="hidden" name="lastName" value={person.last_name} />
      <input type="hidden" name="role" value={person.role} />
      <input type="hidden" name="roleOther" value={person.role_other ?? ""} />
      <input type="hidden" name="department" value={person.department} />
      <input type="hidden" name="departmentOther" value={person.department_other ?? ""} />
      <input type="hidden" name="mobilePhone" value={person.mobile_phone ?? ""} />
      <input type="hidden" name="isActive" value={targetActive ? "true" : "false"} />
      <SubmitButton className={targetActive ? "button secondary" : "button danger"} pendingText="מעדכן...">
        {targetActive ? "החזרה לפעילות" : "הוצאה מפעילות"}
      </SubmitButton>
    </form>
  );
}

export function PersonnelImportForm({ action }: { action: FormAction }) {
  return (
    <form action={action} className="personnel-import-form">
      <input className="input" type="file" name="personnelFile" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
      <SubmitButton className="button secondary" pendingText="מייבא...">ייבוא מאקסל</SubmitButton>
    </form>
  );
}
