import { NextRequest, NextResponse } from "next/server";
import { proxyMatcherPost } from "@/lib/matcherApi.server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { matchId: string } },
) {
  if (!/^\d+$/.test(params.matchId)) {
    return NextResponse.json({ error: "invalid match id" }, { status: 400 });
  }
  return proxyMatcherPost(request, `/operator/audits/${params.matchId}/verify`);
}
