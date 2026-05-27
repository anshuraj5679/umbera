import { NextRequest, NextResponse } from "next/server";
import { proxyMatcherGet } from "@/lib/matcherApi.server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json({ error: "invalid match id" }, { status: 400 });
  }
  return proxyMatcherGet(request, `/matches/${params.id}`);
}
