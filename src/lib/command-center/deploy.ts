// ============================================================================
// Command Center — DeployProvider interface + local implementation
// ============================================================================
// Pluggable deploy backends. v1 ships a `local` implementation that restarts a
// pm2/system process and smoke-tests the target URL. Remote providers
// (Vercel/Netlify) implement the same interface later.
// ============================================================================

import { execFile } from 'node:child_process';
import type { DeployResult, DeployTarget } from './types';

export interface DeployProvider {
  readonly kind: string;
  deploy(target: DeployTarget): Promise<DeployResult>;
}

function run(prog: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(prog, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

async function smokeTest(url: string, expectedStatus: number, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status !== expectedStatus) {
      throw new Error(`Expected HTTP ${expectedStatus}, got ${res.status} from ${url}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Local deploy: restart a process (pm2 restart <name> or a raw command) then
 *  smoke-test the URL. Degrades gracefully when pm2/process is unavailable. */
export class LocalDeployProvider implements DeployProvider {
  readonly kind = 'local';

  async deploy(target: DeployTarget): Promise<DeployResult> {
    const started = Date.now();

    // 1. Restart the process if one is named.
    if (target.process) {
      try {
        const { stdout, stderr } = await run('npx.cmd', ['pm2', 'restart', target.process], 60_000);
        return this.finish(target, true, `Restarted pm2 process "${target.process}"`, { stdout, stderr }, started);
      } catch {
        // pm2 may not be present; fall back to a plain restart of the app dir.
        try {
          const { stdout, stderr } = await run('npm.cmd', ['run', 'start', '--', target.process], 30_000);
          return this.finish(target, true, `Started via npm start "${target.process}"`, { stdout, stderr }, started);
        } catch (err2) {
          return this.finish(
            target,
            false,
            `Deploy failed: ${err2 instanceof Error ? err2.message : String(err2)}`,
            {},
            started,
          );
        }
      }
    }

    // 2. No process — just smoke-test the URL.
    if (target.url) {
      try {
        await smokeTest(target.url, target.expectedStatus ?? 200, 30_000);
        return this.finish(target, true, `Smoke test passed for ${target.url}`, {}, started);
      } catch (err) {
        return this.finish(
          target,
          false,
          `Smoke test failed: ${err instanceof Error ? err.message : String(err)}`,
          {},
          started,
        );
      }
    }

    return this.finish(target, false, 'Deploy target has neither process nor url', {}, started);
  }

  private finish(
    target: DeployTarget,
    ok: boolean,
    message: string,
    extra: { stdout?: string; stderr?: string },
    started: number,
  ): DeployResult {
    return {
      ok,
      message,
      stdout: extra.stdout,
      stderr: extra.stderr,
      durationMs: Date.now() - started,
    };
  }
}

/** Resolve the provider for a target's kind. Unknown kinds throw. */
export function getDeployProvider(kind: string): DeployProvider {
  if (kind === 'local') return new LocalDeployProvider();
  throw new Error(`No deploy provider registered for kind "${kind}"`);
}
