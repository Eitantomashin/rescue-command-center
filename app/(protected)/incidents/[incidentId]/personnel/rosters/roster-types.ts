export type RosterStatus = "draft" | "ready" | "en_route" | "arrived" | "cancelled";
export type MovementType = "outbound_to_incident" | "return_to_unit" | "between_sites" | "exercise" | "other";

export type VehicleRosterListRow = {
  id: string;
  incident_id: string;
  display_number: string;
  main_sequence: number;
  clone_suffix_index: number;
  root_roster_id: string | null;
  source_roster_id: string | null;
  status: RosterStatus;
  movement_type: MovementType;
  origin_text: string | null;
  destination_text: string | null;
  vehicle_license_plate: string | null;
  vehicle_description: string | null;
  planned_departure_at: string | null;
  actual_departure_at: string | null;
  actual_arrival_at: string | null;
  participant_count: number;
  driver_names: string | null;
  movement_commander_names: string | null;
  updated_at: string | null;
};

export type VehicleRosterParticipant = {
  id: string;
  source_type: string;
  unit_personnel_id: string | null;
  manual_personnel_id: string | null;
  external_person_id: string | null;
  display_name_snapshot: string;
  normalized_mobile_phone: string | null;
  is_driver: boolean;
  is_movement_commander: boolean;
  is_passenger: boolean;
  notes: string | null;
  added_at: string | null;
  updated_at: string | null;
};

export type VehicleRosterDetail = VehicleRosterListRow & {
  origin_site_id?: string | null;
  destination_site_id?: string | null;
  vehicle_type?: string | null;
  vehicle_notes?: string | null;
  operational_notes?: string | null;
  ready_at?: string | null;
  departed_at?: string | null;
  arrived_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  created_at?: string | null;
  participants: VehicleRosterParticipant[];
};

export type EligibleRosterPerson = {
  source_type: "unit_personnel" | "manual_personnel" | "external_person";
  source_id: string;
  display_name: string;
  mobile_phone: string | null;
  normalized_mobile_phone: string | null;
  source_label: string | null;
  organic_team: string | null;
  ad_hoc_teams: string | null;
  attendance_status: string | null;
  is_allocated?: boolean | null;
  allocated_roster_id: string | null;
  allocated_roster_display_number: string | null;
  allocated_roster_status?: RosterStatus | null;
};

export type SiteOption = {
  id: string;
  name: string;
};

export const ROSTER_STATUS_LABELS: Record<RosterStatus, string> = {
  draft: "טיוטה",
  ready: "מוכן ליציאה",
  en_route: "בדרך",
  arrived: "הגיע ליעד",
  cancelled: "בוטל"
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  outbound_to_incident: "יציאה לאירוע",
  return_to_unit: "חזרה למחסן היחידה",
  between_sites: "מעבר בין אתרים",
  exercise: "תרגיל",
  other: "אחר"
};

export const ATTENDANCE_LABELS: Record<string, string> = {
  present: "נוכח",
  en_route: "בדרך",
  unavailable: "לא זמין",
  inactive: "לא פעיל"
};

export function sourceLabel(sourceType: string) {
  if (sourceType === "unit_personnel") return "צוות אורגני";
  if (sourceType === "manual_personnel") return "נוסף ידנית";
  if (sourceType === "external_person") return "גורם חיצוני - שבצ\"ק בלבד";
  return "מקור לא ידוע";
}

export function rosterStatusClass(status: string) {
  if (status === "ready") return "status-ready";
  if (status === "en_route") return "status-en-route";
  if (status === "arrived") return "status-arrived";
  if (status === "cancelled") return "status-cancelled";
  return "status-draft";
}

export function formatDateTimeLocal(value: string | null | undefined) {
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

export function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
