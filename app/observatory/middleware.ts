// Explicit per-IP token bucket on /api/* — 30 req/min (flatline SDD-B4/B6:
// "Vercel defaults" are NOT claimed as abuse control; this middleware is the
// claim). In-memory per instance: serverless instances each get their own
// bucket, which bounds (not eliminates) burst across instances — the CDN
// cache on deterministic params is the primary absorber; this is the floor.
import { NextRequest, NextResponse } from "next/server";

const CAPACITY = 30; // tokens
const REFILL_PER_MS = 30 / 60_000; // 30 per minute

type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();

export function middleware(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";

  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: CAPACITY, last: now };
  b.tokens = Math.min(CAPACITY, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;

  if (b.tokens < 1) {
    buckets.set(ip, b);
    return new NextResponse(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    });
  }

  b.tokens -= 1;
  buckets.set(ip, b);

  // bound the map so a rotating-IP scan can't grow memory unbounded
  if (buckets.size > 10_000) {
    const oldest = [...buckets.entries()].sort((a, z) => a[1].last - z[1].last);
    for (const [k] of oldest.slice(0, 5_000)) buckets.delete(k);
  }

  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
