import { NextRequest } from "next/server";
import { proxyMatcherPost } from "@/lib/matcherApi.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return proxyMatcherPost(request, "/agent/orders");
}
