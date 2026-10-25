import { SimResults } from "@/components/SimResults";

export default async function SimulationPage({ params }: { params: Promise<{ id: string }> }) {
  return <SimResults id={(await params).id} />;
}
