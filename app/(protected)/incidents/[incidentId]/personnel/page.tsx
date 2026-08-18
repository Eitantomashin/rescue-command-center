import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { CollaborativeLockSection } from "../collaborative-lock";
import {
  ATTENDANCE_STATUSES,
  PERSONNEL_DEPARTMENTS,
  type AttendanceStatus,
  labelFromOptions,
  personnelDepartmentLabel,
  personnelRoleLabel
} from "../../../personnel/personnel-options";
import { setEventPersonnelStatus } from "./actions";
import { setManualIncidentPersonnelStatusAction } from "./actions";
import { IncidentPersonnelActionPanels } from "./incident-personnel-action-panels";
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

type TeamRow = {
  id: string;
  team_number: number;
  name: string | null;
  is_active: boolean;
};

type SiteRow = {
  id: string;
  name: string;
};

type ManualPersonnelRow = {
  id: string;
  first_name: string;
  last_name: string;
  mobile_phone: string | null;
  role: string | null;
  notes: string | null;
  organic_team_id: string | null;
  attendance_status: AttendanceStatus;
  attendance_updated_at: string | null;
  source_type: string;
  is_active: boolean;
};

type AdHocTeamRow = {
  id: string;
  name: string;
  purpose: string | null;
  related_site_id: string | null;
  commander_name: string | null;
  notes: string | null;
  status: string;
};

type AdHocMemberRow = {
  id: string;
  ad_hoc_team_id: string;
  unit_personnel_id: string | null;
  manual_personnel_id: string | null;
  notes: string | null;
  unit_personnel?: {
    first_name: string;
    last_name: string;
    mobile_phone: string | null;
  } | null;
  manual_personnel?: {
    first_name: string;
    last_name: string;
    mobile_phone: string | null;
  } | null;
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

function teamLabel(team: TeamRow | null | undefined) {
  if (!team) return "ללא צוות";
  return team.name?.trim() ? team.name : `צוות ${team.team_number}`;
}

export default async function IncidentPersonnelPage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const [
    { data: incident },
    { data: personnelRows, error },
    { data: statusRows },
    { data: canEditPersonnel },
    { data: teamRows },
    { data: siteRows },
    { data: manualRows },
    { data: adHocTeamRows },
    { data: adHocMemberRows }
  ] = await Promise.all([
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
    supabase.rpc("can_edit_personnel", { p_incident_id: params.incidentId }),
    supabase
      .from("teams")
      .select("id,team_number,name,is_active")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
      .order("team_number", { ascending: true }),
    supabase
      .from("sites")
      .select("id,name")
      .eq("incident_id", params.incidentId)
      .order("name", { ascending: true }),
    supabase
      .from("incident_manual_personnel")
      .select("id,first_name,last_name,mobile_phone,role,notes,organic_team_id,attendance_status,attendance_updated_at,source_type,is_active")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("incident_ad_hoc_teams")
      .select("id,name,purpose,related_site_id,commander_name,notes,status")
      .eq("incident_id", params.incidentId)
      .order("status", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("incident_ad_hoc_team_members")
      .select("id,ad_hoc_team_id,unit_personnel_id,manual_personnel_id,notes,unit_personnel:unit_personnel_id(first_name,last_name,mobile_phone),manual_personnel:manual_personnel_id(first_name,last_name,mobile_phone)")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
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
  const teams = ((teamRows ?? []) as TeamRow[]).filter((team) => team.is_active);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const sites = (siteRows ?? []) as SiteRow[];
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const manualPersonnel = ((manualRows ?? []) as ManualPersonnelRow[])
    .filter((row) => row.is_active)
    .sort((a, b) => {
      const byStatus = statusSort(a.attendance_status) - statusSort(b.attendance_status);
      if (byStatus !== 0) return byStatus;
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "he");
    });
  const personnelOptions = [
    ...personnel.map((person) => ({
      key: `roster:${person.id}`,
      name: `${person.first_name} ${person.last_name}`,
      phone: person.mobile_phone,
      teamLabel: personnelDepartmentLabel(person.department, person.department_other),
      attendanceLabel: labelFromOptions(ATTENDANCE_STATUSES, person.attendanceStatus),
      sourceLabel: "צוות אורגני"
    })),
    ...manualPersonnel.map((person) => ({
      key: `manual:${person.id}`,
      name: `${person.first_name} ${person.last_name}`,
      phone: person.mobile_phone,
      teamLabel: teamLabel(teamsById.get(person.organic_team_id ?? "")),
      attendanceLabel: labelFromOptions(ATTENDANCE_STATUSES, person.attendance_status),
      sourceLabel: "נוסף ידנית"
    }))
  ];
  const adHocMembers = ((adHocMemberRows ?? []) as unknown as AdHocMemberRow[]).map((member) => {
    const rosterPerson = member.unit_personnel;
    const manualPerson = member.manual_personnel;
    const person = rosterPerson ?? manualPerson;
    return {
      id: member.id,
      adHocTeamId: member.ad_hoc_team_id,
      name: person ? `${person.first_name} ${person.last_name}` : "איש צוות",
      phone: person?.mobile_phone ?? null,
      sourceLabel: rosterPerson ? "צוות אורגני" : "נוסף ידנית",
      notes: member.notes
    };
  });
  const adHocTeams = ((adHocTeamRows ?? []) as AdHocTeamRow[]).map((team) => ({
    id: team.id,
    name: team.name,
    purpose: team.purpose,
    commanderName: team.commander_name,
    notes: team.notes,
    status: team.status,
    relatedSiteId: team.related_site_id,
    relatedSiteName: team.related_site_id ? sitesById.get(team.related_site_id)?.name ?? null : null,
    members: adHocMembers.filter((member) => member.adHocTeamId === team.id)
  }));
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
        <div className="actions">
          <Link className="button secondary" href={`/incidents/${params.incidentId}/personnel/report`}>דוח כוח אדם</Link>
        </div>
      </div>

      <nav className="personnel-module-tabs" aria-label="ניווט כוח אדם">
        <Link className="active" href={`/incidents/${params.incidentId}/personnel`}>מצבת כוח אדם</Link>
        <Link href={`/incidents/${params.incidentId}/personnel/rosters`}>שבצ"קים ותנועת רכבים</Link>
      </nav>
      {error ? (
        <section className="panel">
          <p className="error">לא ניתן לטעון כ"א: {error.message}</p>
        </section>
      ) : null}

      <IncidentPersonnelActionPanels
        incidentId={params.incidentId}
        canEdit={Boolean(canEditPersonnel)}
        teams={teams.map((team) => ({ id: team.id, label: teamLabel(team) }))}
        sites={sites}
        personnelOptions={personnelOptions}
        adHocTeams={adHocTeams}
      />

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

      <section className="panel personnel-department-panel">
        <div className="section-title-row">
          <div>
            <h2>נוספו ידנית לאירוע</h2>
            <p className="muted">רשומות אלו אינן משנות את רשימת הסגל הקבועה של היחידה.</p>
          </div>
          <span className="status-pill warning">{formatNumber(manualPersonnel.length)}</span>
        </div>
        {manualPersonnel.length === 0 ? (
          <p className="muted">עדיין לא נוספו אנשי צוות ידנית לאירוע.</p>
        ) : (
          <div className="event-personnel-list">
            {manualPersonnel.map((person) => (
              <div className="event-personnel-row" key={person.id}>
                <div>
                  <strong>{person.first_name} {person.last_name}</strong>
                  <span>
                    {person.mobile_phone ?? "אין טלפון"} · {teamLabel(teamsById.get(person.organic_team_id ?? ""))}
                  </span>
                </div>
                <span className="status-pill warning">נוסף ידנית</span>
                <span className={`status-pill ${attendanceClass(person.attendance_status)}`}>
                  {labelFromOptions(ATTENDANCE_STATUSES, person.attendance_status)}
                </span>
                <time>{person.attendance_updated_at ? formatDateTime(person.attendance_updated_at) : "לא עודכן"}</time>
                <CollaborativeLockSection objectType="event_personnel" objectId={person.id}>
                  <form action={setManualIncidentPersonnelStatusAction} className="inline-status-form">
                    <input type="hidden" name="incidentId" value={params.incidentId} />
                    <input type="hidden" name="manualPersonnelId" value={person.id} />
                    <select className="input" name="attendanceStatus" defaultValue={person.attendance_status}>
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
    </main>
  );
}
