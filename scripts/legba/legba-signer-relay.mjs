#!/usr/bin/env node
/**
 * legba-signer-relay.mjs — synchronous bridge for legba-core custody calls.
 *
 * The audited process invokes this with execFileSync so gate() can remain
 * synchronous. The relay only forwards one JSON request to LEGBA_SIGNER_SOCKET;
 * it never holds or loads the gatekeeper private key.
 */
import net from 'node:net';

function readStdinJson() {
  const chunks = [];
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('error', reject);
    process.stdin.on('end', () => {
      const raw = chunks.join('').trim();
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); } // malformed stdin → structured reject, not uncaughtException (F-002)
    });
  });
}

function request(socketPath, payload) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath);
    let buf = '';
    conn.setEncoding('utf8');
    conn.setTimeout(8000); // a hung daemon must not block the relay (F-001)
    conn.on('timeout', () => conn.destroy(new Error('LEGBA_SIGNER_TIMEOUT: signer socket idle')));
    conn.on('connect', () => {
      conn.end(JSON.stringify(payload));
    });
    conn.on('data', (chunk) => { buf += chunk; });
    conn.on('error', reject);
    conn.on('end', () => resolve(buf));
  });
}

async function main() {
  const socketPath = process.env.LEGBA_SIGNER_SOCKET;
  if (!socketPath) throw new Error('LEGBA_SIGNER_SOCKET is required');
  const cmd = process.argv[2];
  const req = await readStdinJson();
  const raw = await request(socketPath, { cmd, ...req });
  const parsed = JSON.parse(raw);
  process.stdout.write(JSON.stringify(parsed));
  if (parsed && parsed.ok === false) process.exit(1);
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, status: 'relay_error', error: e.message }));
  process.exit(1);
});
