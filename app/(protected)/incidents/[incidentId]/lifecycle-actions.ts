"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function requiredValue(formData: FormData, key: string, label: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) {
    throw new Error(`${label} הוא שדה חובה`);
  }
  return value;
}

function nullableValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

export type ClosureBlocker = {
  assignment_id: string;
  equipment_item_id: string;
  asset_identifier: string;
  equipment_type_name: string;
  team_name: string | null;
  location: string | null;
};

export type CloseIncidentState = { error: string | null; blockers: ClosureBlocker[] };

export async function closeIncident(_previous: CloseIncidentState, formData: FormData): Promise<CloseIncidentState> {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { data: reportId, error } = await supabase.rpc("close_incident_lifecycle", {
    p_incident_id: incidentId
  });

  if (error) {
    // The UUID success contract is unchanged. PostgreSQL DETAIL carries every
    // blocker on failure; do not put equipment details in URLs or server errors.
    if (error.code === "55000" && error.details) {
      try {
        const details: unknown = JSON.parse(error.details);
        if (details && typeof details === "object" && "code" in details && details.code === "equipment_running"
          && "blocking_equipment" in details && Array.isArray(details.blocking_equipment)) {
          const blockers: ClosureBlocker[] = details.blocking_equipment.filter((item): item is ClosureBlocker =>
            item && typeof item === "object" && typeof item.assignment_id === "string"
            && typeof item.equipment_item_id === "string" && typeof item.asset_identifier === "string"
            && typeof item.equipment_type_name === "string"
            && (item.team_name === null || typeof item.team_name === "string")
            && (item.location === null || typeof item.location === "string"));
          if (blockers.length) return { error: "לא ניתן לסגור את האירוע. יש להשהות את כל פריטי הציוד הפעילים הבאים ולנסות שוב.", blockers };
        }
      } catch {
        // Unexpected details still produce a visible, non-successful result.
      }
    }
    return { error: "סגירת האירוע נכשלה. יש לבדוק שהאירוע זמין ושיש לך הרשאה לסגור אותו, ולנסות שוב.", blockers: [] };
  }

  revalidatePath(`/incidents/${incidentId}`);
  redirect(`/incidents/${incidentId}/reports/closure?reportId=${reportId}`);
}

export async function reopenIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("reopen_incident_lifecycle", {
    p_incident_id: incidentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
}

export async function pauseIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("pause_incident_lifecycle", {
    p_incident_id: incidentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
}

export async function renameIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const newName = requiredValue(formData, "newName", "שם אירוע");
  const supabase = createClient();
  const { error } = await supabase.rpc("rename_incident_admin", {
    p_incident_id: incidentId,
    p_new_name: newName
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath("/incidents");
}

export async function saveClosureReportText(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const reportId = requiredValue(formData, "reportId", "דוח סגירה");
  const supabase = createClient();
  const { error } = await supabase.rpc("update_closure_report_text", {
    p_report_id: reportId,
    p_command_summary: nullableValue(formData, "commandSummary"),
    p_lessons_learned: nullableValue(formData, "lessonsLearned")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/reports/closure`);
}

export async function closeSite(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("close_site_lifecycle", {
    p_site_id: siteId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}`);
}

export async function reopenSite(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("reopen_site_lifecycle", {
    p_site_id: siteId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}`);
}
