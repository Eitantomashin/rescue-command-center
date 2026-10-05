export type SearchUnitStatus = "not_visited" | "in_progress" | "no_answer" | "clear" | "casualties" | "completed";

export type SearchProcessCategory = "not_visited" | "in_progress" | "no_answer" | "completed";

export type SearchLiveStatus = {
  label: string;
  tone: "not-started" | "in-progress" | "open-items" | "cleared";
};

export type SearchStatusSummary = {
  total_units: number;
  not_visited_count: number;
  in_progress_count?: number;
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
  "in_progress",
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

export function isOpenSearchCasualtyUnit(status: string | null | undefined, casualtiesResolved: boolean | null | undefined) {
  return status === "casualties" && !casualtiesResolved;
}

export function isResolvedSearchCasualtyUnit(status: string | null | undefined, casualtiesResolved: boolean | null | undefined) {
  // complete_casualties writes `completed`; later ordinary saves may change the
  // process status while the monotonic treatment-completion fact remains true.
  void status;
  return Boolean(casualtiesResolved);
}

export function isClearedSearchUnit(status: string | null | undefined) {
  return status === "clear" || status === "completed";
}

export function hasSearchApartmentDamage(hasApartmentDamage: boolean | null | undefined) {
  return Boolean(hasApartmentDamage);
}

export function searchProcessCategory(status: string | null | undefined): SearchProcessCategory {
  const normalized = normalizeSearchUnitStatus(status);
  if (normalized === "not_visited") return "not_visited";
  if (normalized === "no_answer") return "no_answer";
  if (normalized === "clear" || normalized === "completed") return "completed";
  return "in_progress";
}

export function searchUnitProcessLabel(status: string | null | undefined) {
  switch (status) {
    case "not_visited": return "טרם התחילה סריקה";
    case "in_progress":
    case "casualties": return "בסריקה";
    case "no_answer": return "אין מענה";
    case "clear":
    case "completed": return "סריקה הושלמה";
    default: return "סטטוס סריקה לא ידוע";
  }
}

export function searchUnitStatusTone(status: string | null | undefined) {
  switch (status) {
    case "in_progress": return "in-progress";
    case "casualties": return "casualties";
    case "no_answer": return "no-answer";
    case "clear": return "clear";
    case "completed": return "complete";
    case "not_visited": return "not-visited";
    default: return "unknown";
  }
}

export function searchScannedCount(summary: Pick<SearchStatusSummary, "in_progress_count" | "clear_count" | "no_answer_count" | "casualties_count" | "completed_count">) {
  return (summary.in_progress_count ?? 0) + summary.clear_count + summary.no_answer_count + summary.casualties_count + summary.completed_count;
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
    in_progress_count: statuses.filter((status) => status === "in_progress").length,
    clear_count: statuses.filter((status) => status === "clear").length,
    no_answer_count: statuses.filter((status) => status === "no_answer").length,
    casualties_count: statuses.filter((status) => status === "casualties").length,
    completed_count: statuses.filter((status) => status === "completed").length
  };
}
