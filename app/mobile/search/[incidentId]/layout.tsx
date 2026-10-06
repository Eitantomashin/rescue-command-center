import { redirect } from "next/navigation";
import { IncidentPresenceProvider } from "@/app/(protected)/incidents/[incidentId]/incident-presence";
import { createClient } from "@/lib/supabase/server";

export default async function MobileSearchIncidentLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const [
    {
      data: { user }
    },
    { data: sites }
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("sites")
      .select("id,site_number,name,city,street,house_number")
      .eq("incident_id", params.incidentId)
      .eq("site_type", "search_site")
      .eq("is_active", true)
      .order("site_number", { ascending: true })
  ]);

  if (!user) {
    redirect("/login");
  }

  const presenceSites = (sites ?? []).map((site) => ({
    site_id: site.id,
    site_number: site.site_number,
    name: site.name,
    city: site.city,
    street: site.street,
    house_number: site.house_number
  }));

  return (
    <IncidentPresenceProvider
      incidentId={params.incidentId}
      user={{
        id: user.id,
        email: user.email ?? null,
        user_metadata: user.user_metadata
      }}
      sites={presenceSites}
    >
      {children}
    </IncidentPresenceProvider>
  );
}
