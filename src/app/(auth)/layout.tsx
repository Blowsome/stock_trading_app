import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return children;
}
