import { notFound } from "next/navigation";
import { readEquipment } from "./actions";
import { EquipmentScreen } from "./equipment-screen";
import { uuidPattern } from "./equipment-validation";

export default async function EquipmentPage({ params, searchParams }: { params: { incidentId: string }; searchParams?: { assignment?: string | string[] } }) {
  if (!uuidPattern.test(params.incidentId)) notFound();
  const result = await readEquipment(params.incidentId);
  if (result.ok === false && result.denied) notFound();
  return <EquipmentScreen incidentId={params.incidentId} initial={result.ok ? result.data : null}
    targetAssignment={typeof searchParams?.assignment === "string" && uuidPattern.test(searchParams.assignment) ? searchParams.assignment : null}
    initialError={result.ok === false ? result.message : null} />;
}
