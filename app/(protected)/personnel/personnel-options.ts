export const PERSONNEL_ROLES = [
  ["unit_commander", "מפקד יחידה"],
  ["deputy_unit_commander", "סגן מפקד יחידה"],
  ["team_commander", "מפקד/ת צוות"],
  ["deputy_team_commander", "סגן מפקד צוות"],
  ["rescuer", "מחלץ/ת"],
  ["personnel", "כ״א"],
  ["medic", "חובש"],
  ["engineer", "מהנדס"],
  ["other", "אחר"]
] as const;

export const PERSONNEL_DEPARTMENTS = [
  ["headquarters", "מטה"],
  ["logistics", "לוגיסטיקה"],
  ["population", "אוכלוסיה"],
  ["command_post", "חפ״ק"],
  ["medical", "רפואה"],
  ["team_1", "צוות 1"],
  ["team_2", "צוות 2"],
  ["team_3", "צוות 3"],
  ["team_4", "צוות 4"],
  ["other", "אחר"]
] as const;

export const ATTENDANCE_STATUSES = [
  ["present", "נוכח"],
  ["en_route", "בדרך"],
  ["unavailable", "לא זמין"],
  ["inactive", "לא פעיל"]
] as const;

export type PersonnelRole = (typeof PERSONNEL_ROLES)[number][0];
export type PersonnelDepartment = (typeof PERSONNEL_DEPARTMENTS)[number][0];
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number][0];

export function labelFromOptions<T extends string>(options: readonly (readonly [T, string])[], value: string | null | undefined) {
  return options.find(([key]) => key === value)?.[1] ?? value ?? "-";
}

export function personnelRoleLabel(role: string | null | undefined, roleOther?: string | null) {
  return role === "other" && roleOther?.trim() ? roleOther.trim() : labelFromOptions(PERSONNEL_ROLES, role);
}

export function personnelDepartmentLabel(department: string | null | undefined, departmentOther?: string | null) {
  return department === "other" && departmentOther?.trim()
    ? departmentOther.trim()
    : labelFromOptions(PERSONNEL_DEPARTMENTS, department);
}
