import { notFound } from "next/navigation";
import { readEquipment } from "./actions";
import { EquipmentScreen } from "./equipment-screen";
import { uuidPattern } from "./equipment-validation";

export default async function EquipmentPage({ params }: { params: { incidentId: string } }) {
  if (!uuidPattern.test(params.incidentId)) notFound();
  const result = await readEquipment(params.incidentId);
  if (result.ok === false && result.denied) notFound();
  return <EquipmentScreen incidentId={params.incidentId} initial={result.ok ? result.data : null}
    initialError={result.ok === false ? result.message : null} />;
}
