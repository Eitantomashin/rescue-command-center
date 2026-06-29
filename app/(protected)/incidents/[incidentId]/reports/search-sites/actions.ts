"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createSearchSiteReport(incidentId: string, siteId: string, _formData: FormData) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_search_site_report", {
    p_site_id: siteId
  });

  if (error || !data) {
    const message = encodeURIComponent(error?.message ?? "יצירת דוח הסריקה נכשלה");
    redirect(`/incidents/${incidentId}/sites/${siteId}?searchReport=error&message=${message}`);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}/reports/search-sites`);
  redirect(`/incidents/${incidentId}/reports/search-sites/${data}?created=1`);
}
