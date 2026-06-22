export type SitrepSnapshot = {
  schema_version?: number;
  captured_at: string;
  incident: {
    id: string;
    name: string;
    incident_type: string | null;
    city: string | null;
    address: string | null;
    opened_at: string;
    is_closed: boolean;
    status_key: string | null;
    status_label: string | null;
  };
  author: { id: string; display_name: string };
  summary: Record<string, unknown>;
  sites: Array<Record<string, unknown>>;
  teams: Array<Record<string, unknown>>;
  operational_numbers: Array<Record<string, unknown>>;
  personnel: Array<Record<string, unknown>>;
  map_objects: Array<Record<string, unknown>>;
};

export type SituationReportRow = {
  id: string;
  incident_id: string;
  report_number: number;
  snapshot: SitrepSnapshot;
  commander_decisions: string | null;
  meeting_summary: string | null;
  created_by: string;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
};

export function textValue(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function booleanValue(value: unknown) {
  return value === true;
}
