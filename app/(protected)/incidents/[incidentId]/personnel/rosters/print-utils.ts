import {
  MOVEMENT_TYPE_LABELS,
  ROSTER_STATUS_LABELS,
  sourceLabel,
  type RosterStatus,
  type VehicleRosterDetail,
  type VehicleRosterListRow,
  type VehicleRosterParticipant
} from "./roster-types";

export const ROSTER_REPORT_STATUSES: Array<"all" | RosterStatus> = ["all", "draft", "ready", "en_route", "arrived", "cancelled"];
export const ROSTER_REPORT_MODES = ["detailed", "summary"] as const;
export type RosterReportMode = (typeof ROSTER_REPORT_MODES)[number];

export type RosterPrintIncident = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  opened_at: string | null;
};

export function text(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function formatPrintDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatPrintDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function formatPrintTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function participantKey(participant: VehicleRosterParticipant) {
  if (participant.source_type === "unit_personnel" && participant.unit_personnel_id) return "unit_personnel:" + participant.unit_personnel_id;
  if (participant.source_type === "manual_personnel" && participant.manual_personnel_id) return "manual_personnel:" + participant.manual_personnel_id;
  if (participant.source_type === "external_person" && participant.external_person_id) return "external_person:" + participant.external_person_id;
  return participant.id;
}

export function participantRoles(participant: VehicleRosterParticipant) {
  const roles: string[] = [];
  if (participant.is_driver) roles.push("נהג");
  if (participant.is_movement_commander) roles.push("מפקד נסיעה");
  if (participant.is_passenger) roles.push("נוסע");
  return roles.length > 0 ? roles.join(" · ") : "נוסע";
}

export function uniqueParticipantCount(participants: VehicleRosterParticipant[]) {
  const keys = new Set<string>();
  participants.forEach((participant) => {
    keys.add(participantKey(participant));
  });
  return keys.size;
}

export function driverNames(participants: VehicleRosterParticipant[]) {
  return participants.filter((participant) => participant.is_driver).map((participant) => participant.display_name_snapshot).join(", ") || "-";
}

export function commanderNames(participants: VehicleRosterParticipant[]) {
  return participants.filter((participant) => participant.is_movement_commander).map((participant) => participant.display_name_snapshot).join(", ") || "-";
}

export function sourceText(participant: VehicleRosterParticipant) {
  return sourceLabel(participant.source_type);
}

export function rosterKindLabel(roster: Pick<VehicleRosterListRow, "source_roster_id" | "movement_type">) {
  if (!roster.source_roster_id) return "שבצ\"ק מקורי";
  if (roster.movement_type === "return_to_unit") return "נסיעת חזרה";
  if (roster.movement_type === "between_sites") return "המשך ליעד הבא";
  return "שבצ\"ק מקושר";
}

export function rosterRelationshipText(roster: VehicleRosterDetail | VehicleRosterListRow, rosters: VehicleRosterListRow[]) {
  if (!roster.source_roster_id) return null;
  const source = rosters.find((item) => item.id === roster.source_roster_id);
  const root = rosters.find((item) => item.id === roster.root_roster_id) ?? source;
  const sourceNumber = source?.display_number ?? "שבצ\"ק מקור";
  const relationship = roster.movement_type === "return_to_unit" ? "נסיעת חזרה" : roster.movement_type === "between_sites" ? "נסיעת המשך" : "נסיעה מקושרת";
  const chain = root ? rosterChainText(root, rosters) : null;
  return chain ? `${relationship} של שבצ\"ק ${sourceNumber}. חלק משרשרת שבצ\"קים: ${chain}` : `${relationship} של שבצ\"ק ${sourceNumber}.`;
}

export function rosterChainText(root: VehicleRosterListRow, rosters: VehicleRosterListRow[]) {
  return rosters
    .filter((item) => item.id === root.id || item.root_roster_id === root.id)
    .sort(rosterSort)
    .map((item) => item.display_number)
    .join(" ← ");
}

export function statusFilterLabel(status: "all" | RosterStatus) {
  return status === "all" ? "הכל" : ROSTER_STATUS_LABELS[status];
}

export function parseStatusFilter(value: string | string[] | undefined): RosterStatus[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  const allowed = new Set<RosterStatus>(["draft", "ready", "en_route", "arrived", "cancelled"]);
  return raw.split(",").map((item) => item.trim()).filter((item): item is RosterStatus => allowed.has(item as RosterStatus));
}

export function parseReportMode(value: string | string[] | undefined): RosterReportMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "summary" ? "summary" : "detailed";
}

export function reportModeLabel(mode: RosterReportMode) {
  return mode === "summary" ? "דוח תקציר" : "דוח מפורט";
}

export function rosterSort(a: VehicleRosterListRow, b: VehicleRosterListRow) {
  return a.main_sequence - b.main_sequence || a.clone_suffix_index - b.clone_suffix_index;
}

export function statusLabel(status: RosterStatus | string) {
  return ROSTER_STATUS_LABELS[status as RosterStatus] ?? status;
}

export function movementLabel(movementType: string) {
  return MOVEMENT_TYPE_LABELS[movementType as keyof typeof MOVEMENT_TYPE_LABELS] ?? movementType;
}