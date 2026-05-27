import { NextRequest } from "next/server";

import { proxyMatcherGet } from "@/lib/matcherApi.server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return proxyMatcherGet(request, `/matches/${params.id}/audit`);
}
