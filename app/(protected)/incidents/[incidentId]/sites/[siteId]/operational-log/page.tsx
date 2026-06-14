import { OperationalLogView, type SearchParams } from "../../../operational-log/page";

export default async function SiteOperationalLogPage({
  params,
  searchParams
}: {
  params: { incidentId: string; siteId: string };
  searchParams: SearchParams;
}) {
  return OperationalLogView({
    incidentId: params.incidentId,
    fixedSiteId: params.siteId,
    searchParams,
    pageTitle: "יומן מבצעי אתר",
    backHref: `/incidents/${params.incidentId}/sites/${params.siteId}`,
    backLabel: "חזרה לתמונת מבנה"
  });
}
