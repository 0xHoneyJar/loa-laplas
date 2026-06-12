// GET /api/sim?seed&greed&discipline&rooms → sim-gen JSON, byte-identical to
// the CLI (the veve vectors are the contract). Pure function of clamped
// params — the deterministic function is its own cache (SDD §5).
//
// Abuse bounds (flatline SDD-B4/B6): params are validated server-side and
// out-of-range/non-numeric values are REJECTED (400), never silently fixed.
// Rate limiting lives in middleware.ts (per-IP token bucket, 30 req/min).
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // caching is done via CDN headers keyed on params

const execFileP = promisify(execFile);

// Single source: the graduated producer. Override for deployments that
// relocate the bundle (Vercel outputFileTracingIncludes pins it — S5).
const SIM_GEN =
  process.env.SIM_GEN_PATH ??
  join(process.cwd(), "..", "..", "observatory", "producers", "sim-gen.mjs");

type Bound = { min: number; max: number; int: boolean };
const BOUNDS: Record<string, Bound> = {
  seed: { min: 0, max: 2 ** 31 - 1, int: true },
  greed: { min: 0, max: 1, int: false },
  discipline: { min: 0, max: 1, int: false },
  rooms: { min: 2, max: 12, int: true },
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const argv: string[] = [SIM_GEN];

  for (const [name, bound] of Object.entries(BOUNDS)) {
    const raw = url.searchParams.get(name);
    if (raw === null) continue; // absent → sim-gen's own default (vector parity)
    const n = Number(raw);
    if (
      raw.trim() === "" ||
      !Number.isFinite(n) ||
      n < bound.min ||
      n > bound.max ||
      (bound.int && !Number.isInteger(n))
    ) {
      return Response.json(
        { error: `param '${name}' out of range (${bound.min}..${bound.max}${bound.int ? ", integer" : ""})` },
        { status: 400 },
      );
    }
    argv.push(`--${name}`, raw);
  }

  try {
    const { stdout } = await execFileP(process.execPath, argv, {
      env: { ...process.env, LANG: "C", TZ: "UTC" }, // determinism env pinned (flatline SP-B10)
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10_000,
    });
    return new Response(stdout, {
      status: 200,
      headers: {
        "content-type": "application/json",
        // identical request = CDN hit; the URL (params included) is the key
        "cache-control": "public, max-age=3600, s-maxage=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "sim failed" }, { status: 500 });
  }
}
