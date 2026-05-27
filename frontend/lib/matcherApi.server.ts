import { NextRequest, NextResponse } from "next/server";

const LOCAL_MATCHER_API_URL = "http://127.0.0.1:8080";

export async function proxyMatcherGet(
  request: NextRequest,
  path: string,
  forwardedParams: string[] = [],
) {
  return proxyMatcherRequest(request, path, { forwardedParams });
}

export async function proxyMatcherSignedGet(
  request: NextRequest,
  path: string,
) {
  const headers = new Headers();
  for (const key of ["authorization", "x-message", "x-signature"]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }

  return proxyMatcherRequest(request, path, { headers });
}

export async function proxyMatcherPost(
  request: NextRequest,
  path: string,
) {
  const headers = new Headers();
  for (const key of [
    "authorization",
    "content-type",
    "payment",
    "payment-authorization",
    "x-payment",
    "x-agent-bypass-token",
    "x-message",
    "x-signature",
  ]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }

  return proxyMatcherRequest(request, path, {
    method: "POST",
    body: await request.text(),
    headers,
  });
}

async function proxyMatcherRequest(
  request: NextRequest,
  path: string,
  options: {
    forwardedParams?: string[];
    method?: "GET" | "POST";
    body?: string;
    headers?: Headers;
  } = {},
) {
  let upstream: URL;
  try {
    upstream = matcherApiUrl(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "matcher api misconfigured", detail }, { status: 500 });
  }

  for (const key of options.forwardedParams ?? []) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) upstream.searchParams.set(key, value);
  }

  try {
    const response = await fetch(upstream, {
      method: options.method ?? "GET",
      body: options.body,
      headers: options.headers,
      cache: "no-store",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: responseHeaders(response),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "matcher unavailable", detail },
      { status: 502 },
    );
  }
}

function responseHeaders(response: Response) {
  const headers = new Headers({
    "content-type": response.headers.get("content-type") ?? "application/json",
    "cache-control": "no-store",
  });
  for (const key of [
    "payment-required",
    "payment-response",
    "x-payment-response",
    "www-authenticate",
  ]) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
}

function matcherApiUrl(path: string) {
  const raw = (
    process.env.MATCHER_API_URL ??
    (isProductionRuntime() ? undefined : LOCAL_MATCHER_API_URL)
  );
  if (!raw) {
    throw new Error("MATCHER_API_URL is required for deployed matcher proxy routes");
  }

  const base = raw.replace(/\/+$/, "");
  const url = new URL(path, `${base}/`);
  if (isProductionRuntime() && url.protocol !== "https:") {
    throw new Error("MATCHER_API_URL must use https:// in deployed environments");
  }
  return url;
}

function isProductionRuntime() {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}
