import { NextRequest } from "next/server";

import { proxyMatcherSignedGet } from "@/lib/matcherApi.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyMatcherSignedGet(request, "/operator/relayer/state");
}
