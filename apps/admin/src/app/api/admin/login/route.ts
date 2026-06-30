import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const response = await fetch(`${getBackendBaseUrl()}/api/v1/auth/login/password-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: data.message || data.error || "登录失败" }, { status: response.status });
    }

    const proxyResponse = NextResponse.json({
      success: true,
      user: data.user,
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      proxyResponse.headers.set("set-cookie", setCookie);
    }

    return proxyResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
