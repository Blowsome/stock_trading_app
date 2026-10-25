import { redirect } from "next/navigation";
import { getCurrentSim, getCurrentUser } from "@/server/auth";
import { Header } from "@/components/Header";
import { SimBar } from "@/components/SimBar";
import type { SimInfo, SimStatus } from "@/lib/sim";
import { SimProvider } from "@/lib/simContext";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const s = await getCurrentSim();
  const sim: SimInfo | null = s && {
    id: s.id,
    startDate: s.startDate.toISOString().slice(0, 10),
    endDate: s.endDate?.toISOString().slice(0, 10) ?? null,
    status: s.status as SimStatus,
  };
  return (
    <SimProvider sim={sim}>
      <Header name={user.name} />
      {sim && <SimBar />}
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
    </SimProvider>
  );
}
