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
    pageTitle: "\u05d9\u05d5\u05de\u05df \u05de\u05d1\u05e6\u05e2\u05d9 \u05d0\u05ea\u05e8",
    backHref: `/incidents/${params.incidentId}/sites/${params.siteId}`,
    backLabel: "\u05d7\u05d6\u05e8\u05d4 \u05dc\u05ea\u05de\u05d5\u05e0\u05ea \u05de\u05d1\u05e0\u05d4"
  });
}
