export type SearchUnitStatus = "not_visited" | "no_answer" | "clear" | "casualties" | "completed";

export type SearchLiveStatus = {
  label: string;
  tone: "not-started" | "in-progress" | "open-items" | "cleared";
};

export type SearchStatusSummary = {
  total_units: number;
  not_visited_count: number;
  clear_count: number;
  no_answer_count: number;
  casualties_count: number;
  completed_count: number;
  reported_casualties_count?: number;
  open_casualties_count?: number;
  resolved_casualties_count?: number;
};

const SEARCH_UNIT_STATUSES = new Set<SearchUnitStatus>([
  "not_visited",
  "no_answer",
  "clear",
  "casualties",
  "completed"
]);

export function normalizeSearchUnitStatus(status: string | null | undefined): SearchUnitStatus {
  return SEARCH_UNIT_STATUSES.has((status ?? "") as SearchUnitStatus)
    ? (status as SearchUnitStatus)
    : "not_visited";
}

export function searchScannedCount(summary: Pick<SearchStatusSummary, "clear_count" | "no_answer_count" | "casualties_count" | "completed_count">) {
  return summary.clear_count + summary.no_answer_count + summary.casualties_count + summary.completed_count;
}

export function searchLiveStatus(summary: SearchStatusSummary): SearchLiveStatus {
  const scanned = searchScannedCount(summary);

  if (scanned === 0) {
    return { label: "טרם התחיל", tone: "not-started" };
  }

  if (summary.no_answer_count > 0 || summary.casualties_count > 0) {
    return { label: "ממצאים פתוחים", tone: "open-items" };
  }

  if (summary.total_units > 0 && scanned >= summary.total_units) {
    return { label: "אתר מזוכה", tone: "cleared" };
  }

  return { label: "בסריקה", tone: "in-progress" };
}

export function searchSummaryFromStatuses(statuses: SearchUnitStatus[]): SearchStatusSummary {
  return {
    total_units: statuses.length,
    not_visited_count: statuses.filter((status) => status === "not_visited").length,
    clear_count: statuses.filter((status) => status === "clear").length,
    no_answer_count: statuses.filter((status) => status === "no_answer").length,
    casualties_count: statuses.filter((status) => status === "casualties").length,
    completed_count: statuses.filter((status) => status === "completed").length
  };
}
