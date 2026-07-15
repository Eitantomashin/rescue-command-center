"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function requiredValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) {
    throw new Error("Missing required value");
  }
  return value;
}

export async function archiveIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId");
  const incidentName = requiredValue(formData, "incidentName");
  const confirmationName = requiredValue(formData, "confirmationName");

  if (confirmationName !== incidentName) {
    throw new Error("Incident name confirmation does not match");
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("archive_incident", {
    p_incident_id: incidentId,
    p_confirmation_name: confirmationName
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/incidents");
}

export async function restoreIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId");
  const supabase = createClient();
  const { error } = await supabase.rpc("restore_incident_from_archive", {
    p_incident_id: incidentId
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/incidents");
}

export async function permanentlyDeleteIncident(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId");
  const incidentName = requiredValue(formData, "incidentName");
  const confirmationName = requiredValue(formData, "confirmationName");

  if (confirmationName !== incidentName) {
    redirect("/incidents?view=archived&deleteError=confirmation");
  }

  const supabase = createClient();
  console.error("Permanent incident deletion RPC starting", {
    incidentId,
    confirmedName: confirmationName
  });

  const { data, error } = await supabase.rpc("permanently_delete_archived_incident", {
    p_incident_id: incidentId,
    p_confirmation_name: confirmationName
  });

  console.error("Permanent incident deletion RPC finished", {
    incidentId,
    confirmedName: confirmationName,
    data,
    errorMessage: error?.message ?? null,
    errorCode: error?.code ?? null,
    errorDetails: error?.details ?? null,
    errorHint: error?.hint ?? null
  });

  if (error) {
    redirect("/incidents?view=archived&deleteError=failed");
  }

  const { data: incidentAfterDelete, error: verifyError } = await supabase
    .from("incidents")
    .select("id,name,status_id,lifecycle_status,archived_at,closed_at,is_closed,ended_at")
    .eq("id", incidentId)
    .maybeSingle();

  if (verifyError) {
    console.error("Permanent incident deletion verification failed", {
      incidentId,
      confirmedName: confirmationName,
      message: verifyError.message,
      code: verifyError.code,
      details: verifyError.details,
      hint: verifyError.hint
    });
    redirect("/incidents?view=archived&deleteError=failed");
  }

  if (incidentAfterDelete) {
    console.error("Permanent incident deletion did not remove incident row", {
      incidentId,
      confirmedName: confirmationName,
      rpcData: data,
      incident: {
        id: incidentAfterDelete.id,
        name: incidentAfterDelete.name,
        status: incidentAfterDelete.lifecycle_status ?? incidentAfterDelete.status_id,
        status_id: incidentAfterDelete.status_id,
        archived_at: incidentAfterDelete.archived_at,
        closed_at: incidentAfterDelete.closed_at,
        is_closed: incidentAfterDelete.is_closed,
        ended_at: incidentAfterDelete.ended_at
      }
    });
    redirect("/incidents?view=archived&deleteError=failed");
  }

  console.error("Permanent incident deletion verified incident row removed", {
    incidentId,
    confirmedName: confirmationName,
    rpcData: data
  });

  revalidatePath("/incidents");
  redirect("/incidents?view=archived&deleteStatus=deleted");
}
