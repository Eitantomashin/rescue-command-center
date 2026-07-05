import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { operationalTeamLabel } from "@/lib/operational-teams";
import { CommandDashboardHeader, CommandStatusDashboard, type CommandStatusDefinition, type CommandStatusRow } from "../command-dashboard/command-status-dashboard";

type IncidentRow = { id: string; name: string; opened_at: string | null };
type SiteRow = { id: string; site_number: number; name: string | null; street: string | null; house_number: string | null };
type OperationalPersonRow = {
  site_id: string | null;
  person_id: string;
  operational_number: number;
  team_number: number | null;
  first_name: string | null;
  last_name: string | null;
  current_status_key: string | null;
  current_status_label: string | null;
  latest_report_status_label: string | null;
  floor_number: number | null;
  unit_number: string | null;
  resident_first_name: string | null;
  resident_last_name: string | null;
  latest_source_phone: string | null;
  latest_notes: string | null;
  latest_reported_at: string | null;
};

const STATUS_DEFINITIONS: CommandStatusDefinition[] = [
  { id: "unknown", label: "\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2", icon: "?", tone: "gray" },
  { id: "missing", label: "\u05e0\u05e2\u05d3\u05e8", icon: "\u25cf", tone: "orange" },
  { id: "trapped_located", label: "\u05dc\u05db\u05d5\u05d3 \u05d0\u05d5\u05ea\u05e8 \u05d5\u05d8\u05e8\u05dd \u05d7\u05d5\u05dc\u05e5", icon: "!", tone: "red" },
  { id: "evacuated_naf", label: "\u05e4\u05e6\u05d5\u05e2 \u05e4\u05d5\u05e0\u05d4 \u05dc\u05e0\u05d0\u05e4\"\u05dc", icon: "+", tone: "yellow" },
  { id: "evacuated_site", label: "\u05e4\u05e6\u05d5\u05e2 \u05e4\u05d5\u05e0\u05d4 \u05de\u05d4\u05d0\u05ea\u05e8", icon: "\u2197", tone: "green" },
  { id: "dead_trapped", label: "\u05d4\u05e8\u05d5\u05d2 \u05dc\u05db\u05d5\u05d3", icon: "\u271a", tone: "black" },
  { id: "dead_evacuated", label: "\u05d4\u05e8\u05d5\u05d2 \u05e4\u05d5\u05e0\u05d4", icon: "\u271a", tone: "black" },
  { id: "located_outside", label: "\u05d0\u05d5\u05ea\u05e8 \u05de\u05d7\u05d5\u05e5 \u05dc\u05d0\u05ea\u05e8", icon: "\u25c6", tone: "blue" },
  { id: "rescued", label: "\u05d7\u05d5\u05dc\u05e5", icon: "\u2713", tone: "green" },
  { id: "duplicate_cancelled", label: "\u05db\u05e4\u05d9\u05dc\u05d5\u05ea/\u05d1\u05d5\u05d8\u05dc", icon: "\u00d7", tone: "gray" }
];

function normalize(value: string | null | undefined) {
  return (value ?? "").trim();
}

function personName(row: OperationalPersonRow) {
  const direct = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  const resident = [row.resident_first_name, row.resident_last_name].filter(Boolean).join(" ").trim();
  return direct || resident || null;
}

function siteName(site: SiteRow | undefined) {
  if (!site) return null;
  return normalize(site.name) || [site.street, site.house_number].filter(Boolean).join(" ").trim() || `\u05d0\u05ea\u05e8 ${site.site_number}`;
}

function floorApartment(row: OperationalPersonRow) {
  const parts: string[] = [];
  if (row.floor_number !== null && row.floor_number !== undefined) parts.push(`\u05e7\u05d5\u05de\u05d4 ${row.floor_number}`);
  if (row.unit_number) parts.push(`\u05d3\u05d9\u05e8\u05d4 ${row.unit_number}`);
  return parts.join(" / ") || null;
}

function statusLabel(row: OperationalPersonRow) {
  return normalize(row.latest_report_status_label) || normalize(row.current_status_label) || normalize(row.current_status_key) || "\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2";
}

function statusId(row: OperationalPersonRow) {
  const label = statusLabel(row);
  const key = normalize(row.current_status_key).toLowerCase();
  if (label.includes("\u05e0\u05e2\u05d3\u05e8") || key.includes("missing")) return "missing";
  if (label.includes("\u05dc\u05db\u05d5\u05d3") || key.includes("trapped")) return "trapped_located";
  if (label.includes("\u05e0\u05d0\u05e4") || key.includes("naf")) return "evacuated_naf";
  if (label.includes("\u05de\u05d4\u05d0\u05ea\u05e8")) return "evacuated_site";
  if (label.includes("\u05d4\u05e8\u05d5\u05d2 \u05dc\u05db\u05d5\u05d3")) return "dead_trapped";
  if (label.includes("\u05d4\u05e8\u05d5\u05d2 \u05e4\u05d5\u05e0\u05d4")) return "dead_evacuated";
  if (label.includes("\u05de\u05d7\u05d5\u05e5")) return "located_outside";
  if (label === "\u05d7\u05d5\u05dc\u05e5" || key.includes("rescued")) return "rescued";
  if (label.includes("\u05db\u05e4\u05d9\u05dc\u05d5\u05ea") || label.includes("\u05d1\u05d5\u05d8\u05dc") || key.includes("cancel")) return "duplicate_cancelled";
  return "unknown";
}

export default async function CasualtiesDashboardPage({ params }: { params: { incidentId: string } }) {
  const supabase = createClient();
  const [incidentRes, sitesRes, peopleRes] = await Promise.all([
    supabase.from("incidents").select("id,name,opened_at").eq("id", params.incidentId).maybeSingle(),
    supabase.from("sites").select("id,site_number,name,street,house_number").eq("incident_id", params.incidentId).eq("is_active", true).order("site_number", { ascending: true }),
    supabase
      .from("operational_numbers_dashboard")
      .select("site_id,person_id,operational_number,team_number,first_name,last_name,current_status_key,current_status_label,latest_report_status_label,floor_number,unit_number,resident_first_name,resident_last_name,latest_source_phone,latest_notes,latest_reported_at")
      .eq("incident_id", params.incidentId)
      .order("operational_number", { ascending: true })
  ]);

  if (!incidentRes.data) notFound();
  const incident = incidentRes.data as IncidentRow;
  const sites = new Map(((sitesRes.data ?? []) as SiteRow[]).map((site) => [site.id, site]));
  const rows: CommandStatusRow[] = ((peopleRes.data ?? []) as OperationalPersonRow[]).map((person) => {
    const site = person.site_id ? sites.get(person.site_id) : undefined;
    return {
      personId: person.person_id,
      statusId: statusId(person),
      statusLabel: statusLabel(person),
      operationalNumber: person.operational_number,
      name: personName(person),
      siteName: siteName(site),
      floorApartment: floorApartment(person),
      assignedTeam: person.team_number ? operationalTeamLabel(person.team_number) : null,
      lastUpdatedAt: person.latest_reported_at,
      phone: person.latest_source_phone,
      notes: person.latest_notes,
      siteHref: site ? `/incidents/${params.incidentId}/sites/${site.id}` : null,
      teamHref: person.team_number ? `/incidents/${params.incidentId}/personnel` : null,
      operationalNumberHref: site ? `/incidents/${params.incidentId}/sites/${site.id}/operational-numbers?personId=${person.person_id}` : null
    };
  });

  return (
    <main className="casualties-dashboard-page" dir="rtl">
      <CommandDashboardHeader
        eyebrow={"\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3 \u05e0\u05e4\u05d2\u05e2\u05d9\u05dd"}
        title={"\u05ea\u05de\u05d5\u05e0\u05ea \u05de\u05e6\u05d1 \u05e0\u05e4\u05d2\u05e2\u05d9\u05dd \u05d1\u05d0\u05d9\u05e8\u05d5\u05e2"}
        description={`${incident.name} · ${incident.opened_at ? formatDateTime(incident.opened_at) : "\u2014"}`}
        totalLabel={"\u05e1\u05d4\u05f4\u05db \u05de\u05e1\u05e4\u05e8\u05d9\u05dd \u05de\u05d1\u05e6\u05e2\u05d9\u05d9\u05dd"}
        totalValue={rows.length}
      />
      <CommandStatusDashboard statuses={STATUS_DEFINITIONS} rows={rows} initialStatusId="trapped_located" incidentId={params.incidentId} />
    </main>
  );
}
