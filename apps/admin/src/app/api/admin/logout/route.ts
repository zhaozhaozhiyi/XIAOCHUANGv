import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getBackendBaseUrl } from "@/lib/backend";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("xiaochuang_session")?.value;

    const response = await fetch(`${getBackendBaseUrl()}/api/v1/auth/logout`, {
      method: "POST",
      headers: sessionToken ? { cookie: `xiaochuang_session=${sessionToken}` } : undefined,
    });

    const proxyResponse = NextResponse.json({ success: response.ok });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      proxyResponse.headers.set("set-cookie", setCookie);
    }

    return proxyResponse;
  } catch {
    return NextResponse.json({ error: "登出失败" }, { status: 500 });
  }
}
