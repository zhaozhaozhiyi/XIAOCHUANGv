import "server-only";

import type { AdminUser } from "@/lib/types";

import { backendFetch } from "./backend";

interface SessionResponse {
  authenticated: boolean;
  session?: {
    user: AdminUser;
  };
}

export async function getAdminSession(): Promise<AdminUser | null> {
  try {
    const response = await backendFetch("/api/v1/auth/session");
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as SessionResponse;
    const user = data?.session?.user;
    if (!data?.authenticated || !user) {
      return null;
    }

    if (!["admin", "super_admin"].includes(user.role)) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}
