"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw.length > 0 ? raw : null;
}

function requiredValue(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);
  if (!raw) {
    throw new Error(`${label} הוא שדה חובה`);
  }
  return raw;
}

function requestedAtValue(formData: FormData) {
  const raw = value(formData, "receivedAt");
  if (!raw) {
    return new Date().toISOString();
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("זמן קבלת ההודעה אינו תקין");
  }

  return parsed.toISOString();
}

const treatmentStatusLabels: Record<string, string> = {
  open: "פתוח",
  in_progress: "בטיפול",
  closed: "נסגר"
};

function treatmentStatusLabel(status: string | null) {
  return treatmentStatusLabels[status ?? ""] ?? status ?? "פתוח";
}

function metadataText(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataBoolean(metadata: Record<string, unknown> | null | undefined, key: string) {
  return metadata?.[key] === true;
}

function metadataStringArray(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export async function createGeneralOperationalNote(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const fixedSiteId = nullableValue(formData, "fixedSiteId");
  const noteTitle = requiredValue(formData, "noteTitle", "כותרת");
  const noteContent = requiredValue(formData, "noteContent", "תוכן");
  const sourceType = requiredValue(formData, "sourceType", "מקור ההודעה");
  const sourceName = nullableValue(formData, "sourceName");
  const sourcePhone = nullableValue(formData, "sourcePhone");
  const receivedAt = requestedAtValue(formData);
  const importance = value(formData, "importance") || "normal";
  const treatmentStatus = value(formData, "treatmentStatus") || "open";
  const allSites = formData.get("allSites") === "on";
  const selectedSiteIds = formData.getAll("siteIds").map(String).filter(Boolean);
  const noteGroupId = randomUUID();
  const supabase = createClient();

  let targetSiteIds: Array<string | null> = [];

  if (fixedSiteId) {
    targetSiteIds = [fixedSiteId];
  } else if (allSites) {
    const { data: siteRows, error } = await supabase
      .from("sites")
      .select("id")
      .eq("incident_id", incidentId)
      .order("site_number", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    targetSiteIds = (siteRows ?? []).map((site) => site.id as string);
    if (targetSiteIds.length === 0) {
      targetSiteIds = [null];
    }
  } else {
    targetSiteIds = selectedSiteIds;
    if (targetSiteIds.length === 0) {
      throw new Error("יש לבחור אתר אחד לפחות או לסמן כל האתרים");
    }
  }

  for (const siteId of targetSiteIds) {
    const { error } = await supabase.rpc("create_event_log", {
      p_incident_id: incidentId,
      p_log_type: "general_operational_note",
      p_title: "📝 הערה כללית",
      p_description: noteTitle,
      p_category: "operational",
      p_importance: importance,
      p_reported_at: receivedAt,
      p_site_id: siteId,
      p_source_type: sourceType,
      p_source_name: sourceName,
      p_metadata: {
        note_group_id: noteGroupId,
        note_title: noteTitle,
        note_content: noteContent,
        information_source_type: sourceType,
        source_name: sourceName,
        source_phone: sourcePhone,
        received_at: receivedAt,
        importance,
        treatment_status: treatmentStatus,
        all_sites: Boolean(allSites && !fixedSiteId),
        selected_site_ids: fixedSiteId ? [fixedSiteId] : targetSiteIds.filter(Boolean)
      }
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath(`/incidents/${incidentId}/operational-log`);
  revalidatePath(`/incidents/${incidentId}`);

  for (const siteId of targetSiteIds) {
    if (siteId) {
      revalidatePath(`/incidents/${incidentId}/sites/${siteId}/operational-log`);
    }
  }
}

export async function updateGeneralOperationalNoteStatus(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const originalNoteEventLogId = requiredValue(formData, "originalNoteEventLogId", "הערה");
  const newTreatmentStatus = requiredValue(formData, "newTreatmentStatus", "מצב טיפול");
  const fixedSiteId = nullableValue(formData, "fixedSiteId");
  const supabase = createClient();

  if (!Object.prototype.hasOwnProperty.call(treatmentStatusLabels, newTreatmentStatus)) {
    throw new Error("מצב הטיפול שנבחר אינו תקין");
  }

  const { data: originalNote, error: originalError } = await supabase
    .from("event_logs")
    .select("id,incident_id,site_id,log_type,title,description,importance,reported_at,metadata")
    .eq("id", originalNoteEventLogId)
    .eq("incident_id", incidentId)
    .maybeSingle();

  if (originalError || !originalNote || originalNote.log_type !== "general_operational_note") {
    throw new Error("לא נמצאה הערה כללית מתאימה לעדכון");
  }

  const originalMetadata = (originalNote.metadata ?? {}) as Record<string, unknown>;
  const noteGroupId = metadataText(originalMetadata, "note_group_id") ?? originalNote.id;
  const noteTitle = metadataText(originalMetadata, "note_title") ?? originalNote.description ?? "הערה כללית";
  const appliesToAllSites = metadataBoolean(originalMetadata, "all_sites");
  let relatedSiteIds = metadataStringArray(originalMetadata, "selected_site_ids");

  if (originalNote.site_id && !relatedSiteIds.includes(originalNote.site_id)) {
    relatedSiteIds = [originalNote.site_id, ...relatedSiteIds];
  }

  const targetSiteIds: Array<string | null> = relatedSiteIds.length > 0 ? relatedSiteIds : [null];

  const { data: relatedLogs, error: relatedError } = await supabase
    .from("event_logs")
    .select("id,log_type,reported_at,metadata")
    .eq("incident_id", incidentId)
    .in("log_type", ["general_operational_note", "general_operational_note_status_changed"])
    .order("reported_at", { ascending: false })
    .limit(1000);

  if (relatedError) {
    throw new Error(relatedError.message);
  }

  const latestStatusLog = (relatedLogs ?? []).find((log) => {
    const metadata = (log.metadata ?? {}) as Record<string, unknown>;
    return (
      metadataText(metadata, "note_group_id") === noteGroupId ||
      metadataText(metadata, "original_note_event_log_id") === originalNoteEventLogId
    );
  });
  const oldTreatmentStatus =
    metadataText((latestStatusLog?.metadata ?? {}) as Record<string, unknown>, "new_treatment_status") ??
    metadataText(originalMetadata, "treatment_status") ??
    "open";

  if (oldTreatmentStatus === newTreatmentStatus) {
    throw new Error("מצב הטיפול כבר מעודכן לערך שנבחר");
  }

  const statusUpdateGroupId = randomUUID();

  for (const siteId of targetSiteIds) {
    const normalizedSiteId = siteId || null;
    const { error } = await supabase.rpc("create_event_log", {
      p_incident_id: incidentId,
      p_log_type: "general_operational_note_status_changed",
      p_title: "עדכון מצב טיפול בהערה כללית",
      p_description: `${noteTitle}: ${treatmentStatusLabel(oldTreatmentStatus)} → ${treatmentStatusLabel(newTreatmentStatus)}`,
      p_category: "operational",
      p_importance: originalNote.importance ?? "normal",
      p_reported_at: new Date().toISOString(),
      p_site_id: normalizedSiteId,
      p_metadata: {
        status_update_group_id: statusUpdateGroupId,
        note_group_id: noteGroupId,
        original_note_event_log_id: originalNoteEventLogId,
        old_treatment_status: oldTreatmentStatus,
        old_treatment_status_label: treatmentStatusLabel(oldTreatmentStatus),
        new_treatment_status: newTreatmentStatus,
        new_treatment_status_label: treatmentStatusLabel(newTreatmentStatus),
        note_title: noteTitle,
        related_site_ids: relatedSiteIds.filter(Boolean),
        applies_to_all_sites: appliesToAllSites
      }
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);

  for (const siteId of targetSiteIds) {
    if (siteId) {
      revalidatePath(`/incidents/${incidentId}/sites/${siteId}/operational-log`);
    }
  }

  if (fixedSiteId) {
    revalidatePath(`/incidents/${incidentId}/sites/${fixedSiteId}/operational-log`);
  }
}
