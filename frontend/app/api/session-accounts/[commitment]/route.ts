import { NextRequest } from "next/server";
import { proxyMatcherGet } from "@/lib/matcherApi.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { commitment: string } }) {
  return proxyMatcherGet(request, `/session-accounts/${params.commitment}`);
}
