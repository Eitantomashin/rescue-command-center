"use server";

import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

export type CommandTimelineEvent = {
  id: string;
  time: string | null;
  timeLabel?: string;
  title: string;
  description: string | null;
  actor: string | null;
  source: string | null;
  remarks: string | null;
  href: string | null;
};

type HistoryRow = {
  report_id: string;
  status_label: string | null;
  information_source_type: string | null;
  information_source_name: string | null;
  source_phone: string | null;
  notes: string | null;
  reported_at: string | null;
  created_at: string | null;
  created_by: string | null;
  history_kind: string | null;
};

type EventRow = { id: string; title: string; description: string | null; reported_at: string; created_by: string | null };
type ProfileRow = { id: string; display_name: string | null };

function historyTitle(row: HistoryRow) {
  if (row.history_kind === "create") return "\u05de\u05e1\u05e4\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9 \u05e0\u05d5\u05e6\u05e8";
  if (row.status_label) return `\u05e1\u05d8\u05d8\u05d5\u05e1: ${row.status_label}`;
  return "\u05d3\u05d9\u05d5\u05d5\u05d7 \u05de\u05d1\u05e6\u05e2\u05d9";
}

export async function loadOperationalPersonCommandTimeline(incidentId: string, personId: string) {
  const supabase = createClient();
  const { error: permissionError } = await supabase.rpc("assert_incident_viewer", { p_incident_id: incidentId });
  if (permissionError) throw new Error("Unauthorized");

  const [historyRes, eventsRes] = await Promise.all([
    supabase
      .from("operational_report_history")
      .select("report_id,status_label,information_source_type,information_source_name,source_phone,notes,reported_at,created_at,created_by,history_kind")
      .eq("incident_id", incidentId)
      .eq("person_id", personId)
      .order("reported_at", { ascending: false })
      .limit(40),
    supabase
      .from("event_logs")
      .select("id,title,description,reported_at,created_by")
      .eq("incident_id", incidentId)
      .eq("person_id", personId)
      .order("reported_at", { ascending: false })
      .limit(40)
  ]);

  if (historyRes.error) throw new Error(historyRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const history = (historyRes.data ?? []) as HistoryRow[];
  const events = (eventsRes.data ?? []) as EventRow[];
  const actorIds = Array.from(new Set([...history.map((row) => row.created_by), ...events.map((row) => row.created_by)].filter(Boolean) as string[]));
  const profilesRes = actorIds.length ? await supabase.from("profiles").select("id,display_name").in("id", actorIds) : { data: [] as ProfileRow[] };
  const profiles = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile.display_name ?? "\u2014"]));

  const items: CommandTimelineEvent[] = [
    ...history.map((row) => ({
      id: `history-${row.report_id}`,
      time: row.reported_at ?? row.created_at,
      title: historyTitle(row),
      description: row.information_source_name || row.source_phone || null,
      actor: row.created_by ? profiles.get(row.created_by) ?? null : null,
      source: row.information_source_type || row.information_source_name || null,
      remarks: row.notes,
      href: null
    })),
    ...events.map((row) => ({
      id: `event-${row.id}`,
      time: row.reported_at,
      title: row.title,
      description: row.description,
      actor: row.created_by ? profiles.get(row.created_by) ?? null : null,
      source: "\u05d9\u05d5\u05de\u05df \u05de\u05d1\u05e6\u05e2\u05d9",
      remarks: null,
      href: `/incidents/${incidentId}/operational-log?eventId=${row.id}`
    }))
  ].sort((a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime());

  return items.map((item) => ({ ...item, timeLabel: item.time ? formatDateTime(item.time) : "\u2014" }));
}
