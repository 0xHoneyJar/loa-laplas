#!/usr/bin/env node
// verify-vectors — run every veve.json vector against the CLI and compare
// sha256(stdout). The vectors ARE the contract; this is the CI teeth.
// Determinism env pinned per flatline SP-B10: LANG=C TZ=UTC.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const veve = JSON.parse(readFileSync(join(here, "veve.json"), "utf8"));
const env = { ...process.env, LANG: "C", TZ: "UTC" };

let failed = 0;
for (const v of veve.vectors) {
  let out = "";
  let exit = 0;
  try {
    out = execFileSync(process.execPath, [join(here, "obs.mjs"), ...v.argv], {
      encoding: "utf8",
      input: v.stdin ?? "",
      env,
    });
  } catch (e) {
    exit = e.status ?? 1;
    out = e.stdout ?? "";
  }
  const got = `sha256:${createHash("sha256").update(out).digest("hex")}`;
  const hashOk = got === v.expect_output_hash;
  const exitOk = exit === (v.expect_exit ?? 0);
  if (hashOk && exitOk) {
    console.log(`  ✓ ${v.name}`);
  } else {
    failed++;
    console.error(`  ✗ ${v.name}`);
    if (!hashOk) console.error(`      hash: got ${got}\n            want ${v.expect_output_hash}`);
    if (!exitOk) console.error(`      exit: got ${exit} want ${v.expect_exit ?? 0}`);
  }
}
console.log(failed === 0 ? `vectors: ${veve.vectors.length}/${veve.vectors.length} byte-match` : `vectors: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
