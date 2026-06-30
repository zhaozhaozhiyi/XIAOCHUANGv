import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/session";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();

  if (session) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
