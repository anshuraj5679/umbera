import { NextRequest, NextResponse } from "next/server";
import { proxyMatcherGet } from "@/lib/matcherApi.server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { pairId: string } },
) {
  const pairId = Number(params.pairId);
  if (!Number.isInteger(pairId) || pairId < 0) {
    return NextResponse.json({ error: "invalid pairId" }, { status: 400 });
  }

  return proxyMatcherGet(request, `/markets/${pairId}/candles`, ["interval", "limit"]);
}
