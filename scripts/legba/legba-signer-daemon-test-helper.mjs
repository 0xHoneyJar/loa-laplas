import { spawn } from 'node:child_process';

const DAEMON = new URL('./legba-signer-daemon.mjs', import.meta.url).pathname;

export function startSignerDaemon(socketPath, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DAEMON], {
      env: { ...process.env, ...env, LEGBA_SIGNER_SOCKET: socketPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      stdout += c;
      const line = stdout.split('\n').find(Boolean);
      if (!line || settled) return;
      try {
        const ready = JSON.parse(line);
        if (ready.ok) {
          settled = true;
          resolve({
            child,
            stop: () => stopSignerDaemon(child),
          });
        } else {
          fail(new Error(`signer daemon failed: ${line}`));
        }
      } catch { /* wait for a full JSON line */ }
    });
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      if (!settled) fail(new Error(`signer daemon exited before ready: code=${code} signal=${signal} stderr=${stderr}`));
    });
  });
}

export function stopSignerDaemon(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 1000).unref();
  });
}
