import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { CollaborativeLockSection } from "../collaborative-lock";
import {
  ATTENDANCE_STATUSES,
  PERSONNEL_DEPARTMENTS,
  type AttendanceStatus,
  labelFromOptions,
  personnelRoleLabel
} from "../../../personnel/personnel-options";
import { setEventPersonnelStatus } from "./actions";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";

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

type StatusRow = {
  personnel_id: string;
  attendance_status: AttendanceStatus;
  updated_at: string;
};

type EventPersonnel = PersonnelRow & {
  attendanceStatus: AttendanceStatus;
  attendanceUpdatedAt: string | null;
};

const STATUS_ORDER: AttendanceStatus[] = ["present", "en_route", "unavailable", "inactive"];

function statusSort(status: AttendanceStatus) {
  return STATUS_ORDER.indexOf(status);
}

function attendanceClass(status: AttendanceStatus) {
  if (status === "present") return "success";
  if (status === "en_route") return "warning";
  if (status === "unavailable") return "danger";
  return "neutral";
}

function statusCount(rows: EventPersonnel[], department: string, status: AttendanceStatus) {
  return rows.filter((row) => row.department === department && row.attendanceStatus === status).length;
}

function PersonnelStatusOptions() {
  return (
    <>
      {ATTENDANCE_STATUSES.map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </>
  );
}

export default async function IncidentPersonnelPage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const [{ data: incident }, { data: personnelRows, error }, { data: statusRows }, { data: canEditPersonnel }] = await Promise.all([
    supabase.from("incidents").select("id,name").eq("id", params.incidentId).maybeSingle(),
    supabase
      .from("unit_personnel")
      .select("id,first_name,last_name,role,role_other,department,department_other,mobile_phone,is_active")
      .order("department", { ascending: true })
      .order("last_name", { ascending: true }),
    supabase
      .from("event_personnel_status")
      .select("personnel_id,attendance_status,updated_at")
      .eq("incident_id", params.incidentId),
    supabase.rpc("can_edit_personnel", { p_incident_id: params.incidentId })
  ]);

  const statusesByPerson = new Map(
    ((statusRows ?? []) as StatusRow[]).map((row) => [row.personnel_id, row])
  );
  const personnel = ((personnelRows ?? []) as PersonnelRow[])
    .filter((row) => row.is_active)
    .map((row) => {
      const status = statusesByPerson.get(row.id);
      return {
        ...row,
        attendanceStatus: status?.attendance_status ?? (row.is_active ? "unavailable" : "inactive"),
        attendanceUpdatedAt: status?.updated_at ?? null
      };
    })
    .sort((a, b) => {
      const byStatus = statusSort(a.attendanceStatus) - statusSort(b.attendanceStatus);
      if (byStatus !== 0) return byStatus;
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "he");
    });
  const personnelTotals = {
    present: personnel.filter((row) => row.attendanceStatus === "present").length,
    enRoute: personnel.filter((row) => row.attendanceStatus === "en_route").length,
    unavailable: personnel.filter((row) => row.attendanceStatus === "unavailable").length,
    inactive: personnel.filter((row) => row.attendanceStatus === "inactive").length,
    total: personnel.length
  };

  return (
    <main className={`page personnel-page${canEditPersonnel ? "" : " permission-readonly"}`}>
      <div className="header">
        <div>
          <p className="eyebrow">כח אדם באירוע</p>
          <h1>כח אדם באירוע</h1>
          <p className="muted">{incident?.name ?? "אירוע"}</p>
        </div>
      </div>

      {error ? (
        <section className="panel">
          <p className="error">לא ניתן לטעון כ"א: {error.message}</p>
        </section>
      ) : null}

      <section className="panel">
        <h2>סיכום לפי מחלקה</h2>
        <div className="personnel-summary-table">
          <table className="table">
            <thead>
              <tr>
                <th>מחלקה</th>
                {ATTENDANCE_STATUSES.map(([, label]) => (
                  <th key={label}>{label}</th>
                ))}
                <th>סה"כ</th>
              </tr>
            </thead>
            <tbody>
              {PERSONNEL_DEPARTMENTS.map(([department, label]) => {
                const total = personnel.filter((row) => row.department === department).length;
                return (
                  <tr id={`department-${department}`} key={department}>
                    <td>
                      <a href={`#list-${department}`}>{label}</a>
                    </td>
                    {ATTENDANCE_STATUSES.map(([status]) => (
                      <td key={status}>{formatNumber(statusCount(personnel, department, status))}</td>
                    ))}
                    <td className="table-emphasis">{formatNumber(total)}</td>
                  </tr>
                );
              })}
              <tr className="table-total-row">
                <td>סה״כ</td>
                <td>{formatNumber(personnelTotals.present)}</td>
                <td>{formatNumber(personnelTotals.enRoute)}</td>
                <td>{formatNumber(personnelTotals.unavailable)}</td>
                <td>{formatNumber(personnelTotals.inactive)}</td>
                <td className="table-emphasis">{formatNumber(personnelTotals.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {PERSONNEL_DEPARTMENTS.map(([department, departmentLabel]) => {
        const rows = personnel.filter((row) => row.department === department);
        return (
          <section className="panel personnel-department-panel" id={`list-${department}`} key={department}>
            <div className="section-title-row">
              <h2>{departmentLabel}</h2>
              <span className="status-pill neutral">{formatNumber(rows.length)}</span>
            </div>
            {rows.length === 0 ? (
              <p className="muted">אין אנשי צוות במחלקה זו.</p>
            ) : (
              <div className="event-personnel-list">
                {rows.map((person) => (
                  <div className="event-personnel-row" key={person.id}>
                    <div>
                      <strong>{person.first_name} {person.last_name}</strong>
                      <span>{personnelRoleLabel(person.role, person.role_other)} · {person.mobile_phone ?? "אין טלפון"}</span>
                    </div>
                    <span className={`status-pill ${attendanceClass(person.attendanceStatus)}`}>
                      {labelFromOptions(ATTENDANCE_STATUSES, person.attendanceStatus)}
                    </span>
                    <time>{person.attendanceUpdatedAt ? formatDateTime(person.attendanceUpdatedAt) : "לא עודכן"}</time>
                    <CollaborativeLockSection objectType="event_personnel" objectId={person.id}>
                    <form action={setEventPersonnelStatus} className="inline-status-form">
                      <input type="hidden" name="incidentId" value={params.incidentId} />
                      <input type="hidden" name="personnelId" value={person.id} />
                      <select className="input" name="attendanceStatus" defaultValue={person.attendanceStatus}>
                        <PersonnelStatusOptions />
                      </select>
                      <OperationalLoadingButton className="button secondary" label="עדכן" loadingLabel="מעדכן..." />
                    </form>
                    </CollaborativeLockSection>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}
