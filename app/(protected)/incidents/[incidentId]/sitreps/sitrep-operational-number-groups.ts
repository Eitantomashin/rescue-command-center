import { formatDateTime } from "@/lib/format";
import { operationalTeamLabel } from "@/lib/operational-teams";
import { numberValue, textValue, type SitrepSnapshot } from "./sitrep-types";

export type SitrepOperationalNumberRow = {
  key: string;
  operationalNumber: number;
  name: string;
  team: string;
  site: string;
  openedAt: string;
  updatedAt: string;
  notes: string;
};

export type SitrepOperationalNumberGroup = {
  status: string;
  sortValue: number;
  tone: "red" | "orange" | "green" | "blue" | "dark" | "gray";
  icon: string;
  rows: SitrepOperationalNumberRow[];
};

const UNKNOWN_STATUS = "לא ידוע";

const STATUS_SORT_PATTERNS: Array<{ sortValue: number; patterns: string[] }> = [
  { sortValue: 10, patterns: ["לכוד אותר וטרם חולץ"] },
  { sortValue: 20, patterns: ["נעדר", "לא ידוע"] },
  { sortValue: 30, patterns: ["פצוע פונה מהאתר"] },
  { sortValue: 40, patterns: ["פצוע פונה לנאפ", "פצוע פונה לבית חולים"] },
  { sortValue: 50, patterns: ["חולץ", "מחולץ"] },
  { sortValue: 60, patterns: ["אותר מחוץ לאתר"] },
  { sortValue: 70, patterns: ["נפטר", "הרוג"] }
];

function personName(person: Record<string, unknown>) {
  const direct = [person.first_name, person.last_name].map((value) => textValue(value, "")).filter(Boolean).join(" ");
  const resident = [person.resident_first_name, person.resident_last_name]
    .map((value) => textValue(value, ""))
    .filter(Boolean)
    .join(" ");
  return direct || resident || "שם לא ידוע";
}

export function getOperationalNumberStatusLabel(person: Record<string, unknown>) {
  return textValue(person.latest_report_status_label, textValue(person.current_status_label, UNKNOWN_STATUS));
}

export function getOperationalNumberSortValue(status: string) {
  const normalized = status.trim();
  const match = STATUS_SORT_PATTERNS.find((entry) => entry.patterns.some((pattern) => normalized.includes(pattern)));
  return match?.sortValue ?? 900;
}

function getOperationalNumberSummaryTone(sortValue: number): SitrepOperationalNumberGroup["tone"] {
  if (sortValue === 10) return "red";
  if (sortValue === 20 || sortValue === 30 || sortValue === 40) return "orange";
  if (sortValue === 50) return "green";
  if (sortValue === 60) return "blue";
  if (sortValue === 70) return "dark";
  return "gray";
}

function getOperationalNumberSummaryIcon(sortValue: number) {
  if (sortValue === 10) return "!";
  if (sortValue === 20) return "?";
  if (sortValue === 30 || sortValue === 40) return "+";
  if (sortValue === 50) return "✓";
  if (sortValue === 60) return "⌖";
  if (sortValue === 70) return "×";
  return "•";
}

export function formatOperationalTimestamp(value: unknown) {
  return textValue(value, "") ? formatDateTime(String(value)) : "-";
}

function openedTimestamp(person: Record<string, unknown>) {
  return person.created_at ?? person.person_created_at ?? person.latest_report_created_at ?? person.latest_reported_at;
}

function updatedTimestamp(person: Record<string, unknown>) {
  return person.updated_at ?? person.person_updated_at ?? person.latest_reported_at ?? person.latest_report_created_at;
}

export function groupOperationalNumbersByStatus(snapshot: SitrepSnapshot) {
  const groups = new Map<string, SitrepOperationalNumberGroup>();

  snapshot.operational_numbers.forEach((person) => {
    const status = getOperationalNumberStatusLabel(person);
    const sortValue = getOperationalNumberSortValue(status);
    const group = groups.get(status) ?? {
      status,
      sortValue,
      tone: getOperationalNumberSummaryTone(sortValue),
      icon: getOperationalNumberSummaryIcon(sortValue),
      rows: []
    };

    group.rows.push({
      key: textValue(person.person_id, String(person.operational_number)),
      operationalNumber: numberValue(person.operational_number),
      name: personName(person),
      team: operationalTeamLabel(numberValue(person.team_number)),
      site: textValue(person.site_name, "ללא אתר"),
      openedAt: formatOperationalTimestamp(openedTimestamp(person)),
      updatedAt: formatOperationalTimestamp(updatedTimestamp(person)),
      notes: textValue(person.latest_notes, "-")
    });

    groups.set(status, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      rows: group.rows.sort((a, b) => a.operationalNumber - b.operationalNumber)
    }))
    .sort((a, b) => a.sortValue - b.sortValue || a.status.localeCompare(b.status, "he"));
}
