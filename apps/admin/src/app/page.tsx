import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getAdminSession();

  if (session) {
    redirect("/dashboard");
  } else {
    redirect("/login");
  }
}
