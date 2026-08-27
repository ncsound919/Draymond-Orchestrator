// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM â€” Entity Invocation Bridge
// ============================================================================
// Takes an entity's invocation_method and invocation_config and actually
// calls the agent/tool/service. This replaces the `invocation_ready` stubs
// in the chain execution engine with real remote/local invocations.
// ============================================================================

import { execFile, execFileSync } from 'child_process';
import { hostIsLocalServiceAllowed } from './ssrf';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal entity shape required for invocation.
 * Compatible with DraymondEntity from ./types but doesn't import it
 * to keep this module free of Supabase/Next.js dependencies.
 */
export type EntityForInvocation = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  invocation_method: string;
  invocation_config: Record<string, unknown>;
  timeout_seconds: number;
};

/**
 * Structured result returned by every invocation handler.
 */
export type InvocationResult = {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  duration_ms: number;
  status_code?: number;
};

/**
 * Options that callers can pass to override per-invocation behaviour.
 */
export type InvocationOptions = {
  /** Override the entity's timeout_seconds for this invocation. */
  timeout_ms?: number;
  /** Additional headers merged into HTTP-based invocations. */
  extra_headers?: Record<string, string>;
  /** If true, include raw response body in output under `_raw`. */
  include_raw?: boolean;
};

// ============================================================================
// MAIN DISPATCHER
// ============================================================================

/**
 * Invoke an entity using its configured invocation method.
 *
 * Routes to the correct handler based on `entity.invocation_method` and
 * returns a structured {@link InvocationResult} that the chain engine can
 * record against the step.
 */
export async function invokeEntity(
  entity: EntityForInvocation,
  action: string,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const method = entity.invocation_method;

  try {
    switch (method) {
      case 'http_api':
        return invokeHttpApi(entity, action, input, options);
      case 'api_call':
        return invokeApiCall(entity, action, input, options);
      case 'subprocess':
        return invokeSubprocess(entity, input, options);
      case 'cli_command':
        return invokeCliCommand(entity, input, options);
      case 'webhook':
        return invokeWebhook(entity, input, options);
      case 'internal':
        return invokeInternal(entity, action, input);
      case 'manual':
        return invokeManual(entity);
      case 'python_module':
        return invokePythonModule(entity, input, options);
      case 'mcp_tool':
        return invokeMcpTool(entity, input, options);
      case 'mcp_stdio':
        return invokeMcpStdio(entity, action, input, options);
      case 'pipeline':
        return invokePipeline(entity, action, input, options);
      default:
        throw new Error(
          `Unsupported invocation method "${method}" for entity "${entity.name}" (${entity.slug}). ` +
          `Supported methods: http_api, api_call, subprocess, cli_command, webhook, internal, manual, python_module, mcp_tool, mcp_stdio, pipeline.`,
        );
    }
  } catch (err) {
    // Report to Sentry for aggregation, then rethrow so the chain engine
    // records the step failure as usual. Best-effort observability.
    try {
      const { captureException } = await import('../sentry');
      await captureException(err, { tags: { component: 'invoker', entity: entity.slug, action, method } });
    } catch {
      /* observability best-effort */
    }
    throw err;
  }
}

// ============================================================================
// HANDLER: pipeline
// ============================================================================

/**
 * Pipeline invocation â€” the parent agent dispatches to one of its folded
 * tools' real runnable entrypoints via the fleet-pipelines registry.
 *
 * `invocation_config` shape:
 * ```
 * { pipeline: "<parent slug>", tool: "<folded tool id>", action?: string }
 * ```
 * When `tool` is omitted the pipeline's first stage runs. The resolved stage
 * is re-dispatched as a synthetic entity (http / cli / subprocess), so a
 * parent agent is a single dispatcher over its folded tools â€” never a
 * disjointed one-off call.
 */
async function invokePipeline(
  entity: EntityForInvocation,
  action: string,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const parent = config.pipeline as string | undefined;
  const tool = config.tool as string | undefined;

  if (!parent) {
    return failResult('invocation_config.pipeline (parent slug) is required for pipeline', Date.now() - start);
  }

  const { pipelineFor } = await import('./fleet-pipelines');
  const pipeline = pipelineFor(parent);
  if (!pipeline) {
    return failResult(`No fleet pipeline registered for parent "${parent}"`, Date.now() - start);
  }

  const target = tool
    ? pipeline.stages.find((s) => s.tool === tool)
    : pipeline.stages[0];
  if (!target) {
    return failResult(
      tool
        ? `Folded tool "${tool}" is not a stage of pipeline "${parent}" (stages: ${pipeline.stages.map((s) => s.tool).join(', ')})`
        : `Pipeline "${parent}" has no stages`,
      Date.now() - start,
    );
  }

  const { resolveStageRun } = await import('./fleet-pipelines');
  const run = resolveStageRun(target);
  if (!run) {
    return failResult(`Cannot resolve a runnable target for "${target.tool}"`, Date.now() - start);
  }

  // Re-dispatch as a synthetic entity through the matching handler so all the
  // existing security/validation logic applies to pipeline stages too.
  const stageEntity: EntityForInvocation = {
    id: `${parent}:${target.tool}`,
    name: target.label,
    slug: target.tool,
    kind: 'tool',
    invocation_method: run.url ? 'http_api' : (target.kind === 'mcp' ? 'mcp_tool' : 'cli_command'),
    invocation_config: run.url
      ? { url: run.url }
      : { command: run.command, args: run.args ?? [], cwd: run.cwd },
    timeout_seconds: Math.max(30, Math.round((entity.timeout_seconds || 120) / 1)),
  };

  const stageAction = action || 'run';
  if (run.url) {
    return invokeHttpApi(stageEntity, stageAction, input, options);
  }
  if (stageEntity.invocation_method === 'mcp_tool') {
    return invokeMcpTool(stageEntity, input, options);
  }
  return invokeCliCommand(stageEntity, input, options);
}

// ============================================================================
// HELPERS
// ============================================================================

/** Resolve the effective timeout in milliseconds. */
function resolveTimeoutMs(entity: EntityForInvocation, options?: InvocationOptions): number {
  if (options?.timeout_ms && options.timeout_ms > 0) return options.timeout_ms;
  if (entity.timeout_seconds > 0) return entity.timeout_seconds * 1000;
  // Sensible default: 30 seconds
  return 30_000;
}

/** Safely parse a JSON string, returning an empty object on failure. */
function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : { value: parsed };
  } catch {
    return { raw_output: raw };
  }
}

/** Build a failed result without throwing. */
function failResult(error: string, duration_ms: number, status_code?: number): InvocationResult {
  return { success: false, output: {}, error, duration_ms, status_code };
}

/**
 * Truth gate for HTTP invocations: a 200 whose body reports an error is NOT a
 * success. Entities that answer `{"error": "..."}` or `{"success": false}`
 * with HTTP 200 were recorded as completed steps, and their fabricated output
 * flowed downstream as real data. Also detects explicit `ok:false`.
 */
function assessHttpBody(
  response: Response,
  output: Record<string, unknown>,
  bodyText: string,
  duration_ms: number,
  errorPrefix = '',
): InvocationResult {
  if (!response.ok) {
    return {
      success: false,
      output,
      error: `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      duration_ms,
      status_code: response.status,
    };
  }
  const bodyError =
    typeof output.error === 'string' && output.error.trim()
      ? String(output.error)
      : typeof output.message === 'string' && (output.success === false || output.ok === false)
        ? String(output.message)
        : undefined;
  const explicitFalse = output.success === false || output.ok === false;
  if (explicitFalse) {
    return {
      success: false,
      output,
      error: `${errorPrefix}HTTP ${response.status} but body reported failure${bodyError ? `: ${bodyError.slice(0, 300)}` : ''}`,
      duration_ms,
      status_code: response.status,
    };
  }
  return {
    success: true,
    output,
    error: undefined,
    duration_ms,
    status_code: response.status,
  };
}

/**
 * Write to a child's stdin without risking an unhandled EPIPE crash: if the
 * child exits before consuming its stdin, the pipe emits an 'error' event and
 * an uncaught 'error' on any stream takes down the whole orchestrator process
 * mid-chain (orphaning running locks). Errors are swallowed here deliberately â€”
 * the child's exit/non-zero code surfaces the real failure.
 */
function safeWriteStdin(child: import('node:child_process').ChildProcess, data: string): void {
  if (!child.stdin) return;
  // Attach the EPIPE guard only when the stream supports event listeners
  // (test doubles may provide bare write/end stubs).
  const stream = child.stdin as unknown as { on?: (ev: string, cb: () => void) => void };
  if (typeof stream.on === 'function') {
    stream.on('error', () => { /* EPIPE — surfaced via child exit code */ });
  }
  try {
    child.stdin.write(data);
    child.stdin.end();
  } catch { /* same: the exit code carries the failure */ }
}

/**
 * True when a binary is resolvable on PATH (via `where` / `which`).
 * Used to gate `cli_command` / `subprocess` skills on their declared
 * `invocation_config.requires` bins so the fleet never dispatches to a
 * missing runtime.
 */
export function binaryOnPath(bin: string): boolean {
  if (!bin || typeof bin !== 'string') return false;
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(cmd, [bin], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Check an entity's declared `requires` bins; returns the first missing one, or null. */
function missingRequiredBin(entity: EntityForInvocation): string | null {
  const requires = (entity.invocation_config.requires ?? []) as unknown;
  if (!Array.isArray(requires)) return null;
  for (const bin of requires) {
    if (typeof bin === 'string' && !binaryOnPath(bin)) return bin;
  }
  return null;
}

/**
 * Resolve `${ENV_VAR}` references in configured header values at CALL time.
 * Credentials persisted in the registry at seed time (e.g.
 * `Authorization: Bearer ${CRON_SECRET}`) otherwise go stale whenever the
 * underlying env var rotates â€” a silent source of 401/expired_token chain
 * failures. Unresolvable vars expand to empty string (same as before).
 */
function interpolateEnvHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] =
      typeof value === 'string'
        ? value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => process.env[name] ?? '')
        : value;
  }
  return out;
}

/**
 * Validate that a URL does not point to private/internal IP ranges (SSRF protection).
 * Blocks: 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, [::1], localhost, 0.0.0.0
 *
 * In development (NODE_ENV !== 'production'), localhost and private IPs are
 * ALLOWED because the entire agent fleet runs locally. Set ALLOW_LOCAL_AGENTS=1
 * to explicitly allow localhost in any environment, or LOCAL_SERVICE_ALLOWLIST
 * to allow only a fixed set of trusted fleet hosts (see ssrf.ts).
 */
function validateUrlNotPrivate(urlStr: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, error: `Invalid URL: "${urlStr}"` };
  }

  // Only allow http(s) schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Blocked URL scheme: "${parsed.protocol}". Only http/https allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Development mode, ALLOW_LOCAL_AGENTS, or an explicit LOCAL_SERVICE_ALLOWLIST
  // entry bypasses the private-host checks (the agent fleet runs locally).
  if (hostIsLocalServiceAllowed(hostname)) {
    return { valid: true };
  }

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') {
    return { valid: false, error: `Blocked private/localhost URL: "${hostname}"` };
  }

  // Block 0.0.0.0
  if (hostname === '0.0.0.0') {
    return { valid: false, error: `Blocked 0.0.0.0 URL` };
  }

  // Block private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return { valid: false, error: `Blocked private IP range 10.x.x.x` };
    if (a === 172 && b >= 16 && b <= 31) return { valid: false, error: `Blocked private IP range 172.16-31.x.x` };
    if (a === 192 && b === 168) return { valid: false, error: `Blocked private IP range 192.168.x.x` };
    if (a === 169 && b === 254) return { valid: false, error: `Blocked link-local IP range 169.254.x.x` };
    if (a === 127) return { valid: false, error: `Blocked loopback IP range 127.x.x.x` };
  }

  return { valid: true };
}

/**
 * Allowlist of CLI commands that can be executed via cli_command invocation.
 * Only the base command name (first token) is checked.
 */
const ALLOWED_CLI_COMMANDS = new Set([
  'node', 'npm', 'npx', 'python', 'python3', 'pip',
  'curl', 'wget', 'git', 'docker',
]);

/**
 * Blocklist of argument patterns that are dangerous for allowed commands (item 9).
 * Prevents argument injection such as `node --eval "malicious code"`.
 */
const BLOCKED_ARG_PATTERNS: RegExp[] = [
  /^--eval$/i,
  /^-e$/,
  /^--print$/i,
  /^-p$/,
  /^--require$/i,
  /^-r$/,
  /^--import$/i,
  /^--input-type$/i,
  /^-c$/, // python -c
  /^--exec$/i,
  /^--command$/i,
];

/**
 * Validate that an args array contains only safe string arguments (items 9-10).
 * Rejects non-string elements and blocks dangerous argument patterns.
 */
function validateArgs(args: unknown): { valid: boolean; error?: string; sanitized: string[] } {
  if (!Array.isArray(args)) {
    return { valid: false, error: 'invocation_config.args must be an array', sanitized: [] };
  }
  const sanitized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== 'string') {
      return { valid: false, error: `invocation_config.args[${i}] must be a string, got ${typeof arg}`, sanitized: [] };
    }
    // Check against blocked patterns
    for (const pattern of BLOCKED_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        return { valid: false, error: `Blocked dangerous argument: "${arg}" at index ${i}`, sanitized: [] };
      }
    }
    sanitized.push(arg);
  }
  return { valid: true, sanitized };
}

// ============================================================================
// HANDLER: http_api
// ============================================================================

/**
 * HTTP invocation. POSTs (or GETs/PUTs) to the configured URL with the
 * input as a JSON body. Expects `invocation_config` to have:
 * ```
 * { url: string, method?: 'GET'|'POST'|'PUT', headers?: Record<string,string>, timeout_ms?: number }
 * ```
 */
async function invokeHttpApi(
  entity: EntityForInvocation,
  action: string,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;

  // Multi-endpoint support: `endpoints` maps an action â†’ `{ path, method? }`
  // (or a bare path string). `:param` tokens in the path are substituted from
  // `input` (and removed from the request body). Falls back to the base `url`
  // when no endpoint matches.
  const endpoints = (config.endpoints ?? null) as Record<
    string,
    string | { path?: string; method?: string } | undefined
  > | null;
  const rawEndpoint = endpoints && action ? endpoints[action] : undefined;

  let endpointPath: string | undefined;
  let endpointMethod: string | undefined;
  if (typeof rawEndpoint === 'string') {
    endpointPath = rawEndpoint;
  } else {
    endpointPath = rawEndpoint?.path;
    endpointMethod = rawEndpoint?.method;
  }

  let url = config.url as string | undefined;
  let method = ((config.method as string) || 'POST').toUpperCase();
  const payload: Record<string, unknown> = { ...input };

  if (endpointPath) {
    let path = endpointPath;
    path = path.replace(/:([a-zA-Z0-9_]+)/g, (_match, key: string) => {
      const value = payload[key];
      delete payload[key];
      return value === undefined || value === null ? _match : encodeURIComponent(String(value));
    });
    method = (endpointMethod ?? 'POST').toUpperCase();
    url = `${(url ?? '').replace(/\/+$/, '')}${path}`;
  }

  // GET endpoints: carry any remaining input as query parameters.
  if (method === 'GET' && Object.keys(payload).length > 0) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null) continue;
      query.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    const qs = query.toString();
    if (qs) url = `${url}${url?.includes('?') ? '&' : '?'}${qs}`;
  }

  if (!url) {
    return failResult('invocation_config.url is required for http_api', Date.now() - start);
  }

  // SSRF protection: block private/internal IPs
  const urlCheck = validateUrlNotPrivate(url);
  if (!urlCheck.valid) {
    return failResult(`SSRF blocked: ${urlCheck.error}`, Date.now() - start);
  }

  const configHeaders = interpolateEnvHeaders((config.headers ?? {}) as Record<string, string>);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...configHeaders,
    ...options?.extra_headers,
  };

  const timeoutMs = resolveTimeoutMs(entity, options);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      // Do not follow redirects: a validated public URL could redirect to a
      // private/loopback address (SSRF bypass via redirect).
      redirect: 'manual',
    };

    // GET requests should not have a body
    if (method !== 'GET') {
      fetchOptions.body = JSON.stringify({ action, ...payload });
    }

    const response = await fetch(url, fetchOptions);
    // Keep the abort timer alive through the body read: a server that drips
    // (or never finishes) the body previously hung the step forever.
    const duration_ms = Date.now() - start;
    const bodyText = await response.text();
    clearTimeout(timer);
    const output = safeParseJson(bodyText);

    if (options?.include_raw) {
      output._raw = bodyText;
    }

    return assessHttpBody(response, output, bodyText, duration_ms);
  } catch (err) {
    const duration_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    // More robust abort/timeout detection (item 14)
    const isTimeout = (err instanceof DOMException && err.name === 'AbortError') ||
      message.includes('abort') || message.includes('timed out');
    return failResult(
      isTimeout ? `Request timed out after ${timeoutMs}ms` : message,
      duration_ms,
    );
  }
}

// ============================================================================
// HANDLER: api_call
// ============================================================================

/**
 * API call invocation. Always POST, wraps input in `{ action, input }` body.
 * Used for the Uplift Agent at `:8000`.
 */
async function invokeApiCall(
  entity: EntityForInvocation,
  action: string,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const url = config.url as string | undefined;

  if (!url) {
    return failResult('invocation_config.url is required for api_call', Date.now() - start);
  }

  // SSRF protection: block private/internal IPs
  const urlCheck = validateUrlNotPrivate(url);
  if (!urlCheck.valid) {
    return failResult(`SSRF blocked: ${urlCheck.error}`, Date.now() - start);
  }

  const configHeaders = interpolateEnvHeaders((config.headers ?? {}) as Record<string, string>);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...configHeaders,
    ...options?.extra_headers,
  };

  const timeoutMs = resolveTimeoutMs(entity, options);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, input }),
      signal: controller.signal,
      redirect: 'manual',
    });
    const duration_ms = Date.now() - start;
    const bodyText = await response.text();
    clearTimeout(timer);
    const output = safeParseJson(bodyText);

    if (options?.include_raw) {
      output._raw = bodyText;
    }

    return assessHttpBody(response, output, bodyText, duration_ms);
  } catch (err) {
    const duration_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    // More robust abort/timeout detection (item 14)
    const isTimeout = (err instanceof DOMException && err.name === 'AbortError') ||
      message.includes('abort') || message.includes('timed out');
    return failResult(
      isTimeout ? `Request timed out after ${timeoutMs}ms` : message,
      duration_ms,
    );
  }
}

// ============================================================================
// HANDLER: subprocess
// ============================================================================

/**
 * Spawns a child process using `child_process.execFile`.
 * Uses `invocation_config.command` and `invocation_config.args`.
 * Passes input as JSON via stdin. Captures stdout as JSON output.
 */
async function invokeSubprocess(
  entity: EntityForInvocation,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const command = config.command as string | undefined;

  if (!command) {
    return failResult('invocation_config.command is required for subprocess', Date.now() - start);
  }

  // Validate command against allowlist (matches cli_command handler security)
  if (!ALLOWED_CLI_COMMANDS.has(command)) {
    return failResult(
      `Command "${command}" is not in the allowed command list. ` +
      `Allowed: ${[...ALLOWED_CLI_COMMANDS].join(', ')}`,
      Date.now() - start,
    );
  }

  const args = (config.args ?? []) as string[];

  // Check for blocked argument patterns
  for (const arg of args) {
    for (const pattern of BLOCKED_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        return failResult(
          `Blocked argument pattern "${arg}" detected in subprocess args`,
          Date.now() - start,
        );
      }
    }
  }

  const timeoutMs = resolveTimeoutMs(entity, options);

  return new Promise<InvocationResult>((resolve) => {
    const child = execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        const duration_ms = Date.now() - start;

        if (error) {
          const errorMsg = error.killed
            ? `Process timed out after ${timeoutMs}ms`
            : `Process exited with error: ${error.message}${stderr ? ` â€” stderr: ${stderr.slice(0, 500)}` : ''}`;
          resolve(failResult(errorMsg, duration_ms));
          return;
        }

        const output = safeParseJson(stdout.trim());
        if (stderr && stderr.trim()) {
          output._stderr = stderr.trim();
        }

        resolve({ success: true, output, duration_ms });
      },
    );

    // Write input to stdin (EPIPE-safe — see safeWriteStdin)
    if (child.stdin) {
      safeWriteStdin(child, JSON.stringify(input));
    }
  });
}

// ============================================================================
// HANDLER: cli_command
// ============================================================================

/**
 * Executes a shell command via `child_process.execFile` with command allowlisting.
 * The command string is split into base command + args; only allowlisted base
 * commands are permitted. Uses execFile (no shell) to prevent injection.
 * Passes input via the `ENTITY_INPUT` environment variable.
 */
async function invokeCliCommand(
  entity: EntityForInvocation,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const command = config.command as string | undefined;

  if (!command) {
    return failResult('invocation_config.command is required for cli_command', Date.now() - start);
  }

  // Gate on declared required binaries (`invocation_config.requires`) â€” never
  // dispatch to a missing runtime (Step 9).
  const missingBin = missingRequiredBin(entity);
  if (missingBin) {
    return failResult(
      `Required binary "${missingBin}" not found on PATH for "${entity.name}"`,
      Date.now() - start,
    );
  }

  // Split command into base + args and validate against allowlist
  const parts = command.trim().split(/\s+/);
  const baseCommand = parts[0];
  const args = parts.slice(1);

  if (!ALLOWED_CLI_COMMANDS.has(baseCommand)) {
    return failResult(
      `Command "${baseCommand}" is not in the allowed command list. ` +
      `Allowed: ${[...ALLOWED_CLI_COMMANDS].join(', ')}`,
      Date.now() - start,
    );
  }

  // Validate args against the same blocked-pattern allowlist used by
  // invokeSubprocess / invokeMcpStdio, so `--eval`, `-e`, `-c`, etc. can't
  // smuggle code execution past the base-command allowlist.
  const argsValidation = validateArgs(args);
  if (!argsValidation.valid) {
    return failResult(
      argsValidation.error || 'Invalid command arguments',
      Date.now() - start,
    );
  }

  const timeoutMs = resolveTimeoutMs(entity, options);

  return new Promise<InvocationResult>((resolve) => {
    execFile(
      baseCommand,
      argsValidation.sanitized,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: {
          ...process.env,
          ENTITY_INPUT: JSON.stringify(input),
        },
      },
      (error, stdout, stderr) => {
        const duration_ms = Date.now() - start;

        if (error) {
          const errorMsg = error.killed
            ? `Command timed out after ${timeoutMs}ms`
            : `Command failed: ${error.message}${stderr ? ` â€” stderr: ${stderr.slice(0, 500)}` : ''}`;
          resolve(failResult(errorMsg, duration_ms));
          return;
        }

        const output = safeParseJson(stdout.trim());
        if (stderr && stderr.trim()) {
          output._stderr = stderr.trim();
        }

        resolve({ success: true, output, duration_ms });
      },
    );
  });
}

// ============================================================================
// HANDLER: webhook
// ============================================================================

/**
 * Fire-and-forget POST to `invocation_config.url`.
 * Confirms the server accepted the request (2xx) but does not wait
 * for processing to complete.
 */
async function invokeWebhook(
  entity: EntityForInvocation,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const url = config.url as string | undefined;

  if (!url) {
    return failResult('invocation_config.url is required for webhook', Date.now() - start);
  }

  // SSRF protection: block private/internal IPs
  const urlCheck = validateUrlNotPrivate(url);
  if (!urlCheck.valid) {
    return failResult(`SSRF blocked: ${urlCheck.error}`, Date.now() - start);
  }

  const configHeaders = interpolateEnvHeaders((config.headers ?? {}) as Record<string, string>);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...configHeaders,
    ...options?.extra_headers,
  };

  // Webhooks use a short timeout â€” we only care about delivery acknowledgement
  const timeoutMs = Math.min(resolveTimeoutMs(entity, options), 10_000);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timer);

    const duration_ms = Date.now() - start;

    return {
      success: response.ok,
      output: { accepted: response.ok, status: response.status },
      error: response.ok ? undefined : `Webhook delivery failed: HTTP ${response.status}`,
      duration_ms,
      status_code: response.status,
    };
  } catch (err) {
    const duration_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes('abort');
    return failResult(
      isTimeout ? `Webhook delivery timed out after ${timeoutMs}ms` : `Webhook delivery failed: ${message}`,
      duration_ms,
    );
  }
}

// ============================================================================
// HANDLER: internal
// ============================================================================

/**
 * Internal entities are built-in tools that don't require remote invocation.
 *
 * `open-chat-worker` actions enqueue skill-pack tasks into the worker queue so
 * the Open-Chat phone arm picks them up (marketing capture / post / review).
 * Everything else returns a status marker immediately.
 */
async function invokeInternal(
  entity: EntityForInvocation,
  action: string,
  input: Record<string, unknown>,
): Promise<InvocationResult> {
  const start = Date.now();

  if (entity.slug === 'open-chat-worker' && action === 'enqueue_capture') {
    try {
      const { enqueueWorkerTask } = await import('./worker-tasks');
      const skillPackId =
        typeof input.skill_pack_id === 'string'
          ? input.skill_pack_id
          : 'marketing_capture:1.0.0';
      const app = typeof input.app === 'string' ? input.app : '';
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      const taskId = await enqueueWorkerTask({
        skill_pack_id: skillPackId,
        payload: {
          app,
          prompt,
          source: 'marketing-content-capture',
        },
      });
      return {
        success: true,
        output: { task_id: taskId, skill_pack_id: skillPackId, queued: true },
        duration_ms: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        output: {},
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - start,
      };
    }
  }

  return Promise.resolve({
    success: true,
    output: {
      status: 'internal',
      message: 'Internal entity â€” no remote invocation needed',
      entity_id: entity.id,
      entity_slug: entity.slug,
    },
    duration_ms: 0,
  });
}

// ============================================================================
// HANDLER: manual
// ============================================================================

/**
 * Manual entities require human execution. The invoker cannot run them
 * automatically â€” it returns a marker so the chain engine can surface
 * the step for manual completion.
 */
function invokeManual(entity: EntityForInvocation): Promise<InvocationResult> {
  return Promise.resolve({
    success: true,
    output: {
      status: 'manual_required',
      message: 'This entity requires manual execution',
      entity_id: entity.id,
      entity_slug: entity.slug,
    },
    duration_ms: 0,
  });
}

// ============================================================================
// HANDLER: python_module
// ============================================================================

/**
 * Invokes a Python function from a module by spawning a Python process.
 * Expects `invocation_config` to have `{ module: string, function: string }`.
 * Passes input as JSON via stdin, captures stdout as JSON output.
 */
async function invokePythonModule(
  entity: EntityForInvocation,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const moduleName = config.module as string | undefined;
  const functionName = config.function as string | undefined;

  if (!moduleName || !functionName) {
    return failResult(
      'invocation_config.module and invocation_config.function are required for python_module',
      Date.now() - start,
    );
  }

  // Validate module/function names to prevent code injection.
  // Only allow valid Python identifiers separated by dots.
  const pyIdentifier = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
  if (!pyIdentifier.test(moduleName)) {
    return failResult(`Invalid Python module name: "${moduleName}"`, Date.now() - start);
  }
  if (!pyIdentifier.test(functionName)) {
    return failResult(`Invalid Python function name: "${functionName}"`, Date.now() - start);
  }

  const timeoutMs = resolveTimeoutMs(entity, options);

  const script =
    `import json, sys; ` +
    `from ${moduleName} import ${functionName}; ` +
    `print(json.dumps(${functionName}(json.loads(sys.stdin.read()))))`;

  const pythonPath = (config.python_path as string | undefined) ?? 'python';
  const execOptions: import('node:child_process').ExecFileOptions = {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
    env: { ...process.env },
  };
  const workingDir =
    (config.working_dir as string | undefined) ??
    (config.cwd as string | undefined);
  if (typeof workingDir === 'string' && workingDir) {
    execOptions.cwd = workingDir;
  }

  return new Promise<InvocationResult>((resolve) => {
    const child = execFile(
      pythonPath,
      ['-c', script],
      execOptions,
      (error, stdout, stderr) => {
        const duration_ms = Date.now() - start;

        if (error) {
          const errorMsg = error.killed
            ? `Python process timed out after ${timeoutMs}ms`
            : `Python execution failed: ${error.message}${stderr ? ` â€” stderr: ${stderr.slice(0, 500)}` : ''}`;
          resolve(failResult(errorMsg, duration_ms));
          return;
        }

        const stdoutText = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
        const stderrText = typeof stderr === 'string' ? stderr : stderr.toString('utf8');

        const output = safeParseJson(stdoutText.trim());
        if (stderrText && stderrText.trim()) {
          output._stderr = stderrText.trim();
        }

        resolve({ success: true, output, duration_ms });
      },
    );

    if (child.stdin) {
      safeWriteStdin(child, JSON.stringify(input));
    }
  });
}

// ============================================================================
// HANDLER: mcp_tool
// ============================================================================

/**
 * Invokes an MCP tool over HTTP. The MCP server runs as an HTTP service and
 * exposes tools at `/mcp/tools/:tool_name`. Sends input as a JSON body via
 * POST and parses the JSON response.
 *
 * NOTE: This uses a REST-style endpoint pattern (`/mcp/tools/{tool_name}`)
 * rather than the standard MCP JSON-RPC 2.0 single-endpoint protocol.
 * This is intentionally non-standard to support lightweight HTTP-only
 * MCP server implementations (item 12 â€” documented as intentional).
 *
 * The `action` parameter from the step is included in the request body
 * (item 15 â€” previously silently ignored).
 *
 * Expects `invocation_config` to have:
 * ```
 * { server_url: string, tool_name: string, headers?: Record<string, string> }
 * ```
 */
async function invokeMcpTool(
  entity: EntityForInvocation,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const serverUrl = config.server_url as string | undefined;
  const toolName = config.tool_name as string | undefined;
  const action = config.action as string | undefined; // item 15: include action

  if (!serverUrl) {
    return failResult('invocation_config.server_url is required for mcp_tool', Date.now() - start);
  }
  if (!toolName) {
    return failResult('invocation_config.tool_name is required for mcp_tool', Date.now() - start);
  }

  const url = `${serverUrl.replace(/\/+$/, '')}/mcp/tools/${encodeURIComponent(toolName)}`;

  // SSRF protection: block private/internal IPs
  const urlCheck = validateUrlNotPrivate(url);
  if (!urlCheck.valid) {
    return failResult(`SSRF blocked: ${urlCheck.error}`, Date.now() - start);
  }

  const configHeaders = interpolateEnvHeaders((config.headers ?? {}) as Record<string, string>);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...configHeaders,
    ...options?.extra_headers,
  };

  const timeoutMs = resolveTimeoutMs(entity, options);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input, ...(action ? { action } : {}) }),
      signal: controller.signal,
      redirect: 'manual',
    });
    const duration_ms = Date.now() - start;
    const bodyText = await response.text();
    clearTimeout(timer);
    const output = safeParseJson(bodyText);

    if (options?.include_raw) {
      output._raw = bodyText;
    }

    return assessHttpBody(response, output, bodyText, duration_ms, 'MCP tool ');
  } catch (err) {
    const duration_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    // More robust abort/timeout detection (item 14)
    const isTimeout = (err instanceof DOMException && err.name === 'AbortError') ||
      message.includes('abort') || message.includes('timed out');
    return failResult(
      isTimeout ? `MCP tool request timed out after ${timeoutMs}ms` : `MCP tool invocation failed: ${message}`,
      duration_ms,
    );
  }
}

// ============================================================================
// HANDLER: mcp_stdio
// ============================================================================

/**
 * Invokes an MCP tool via JSON-RPC over stdin/stdout. Spawns the MCP server as
 * a child process, performs the standard MCP initialize handshake, then sends a
 * `tools/call` request. Reads the JSON-RPC response from stdout.
 *
 * Expects `invocation_config` to have:
 * ```
 * { command: string, args?: string[], tool_name?: string, cwd?: string }
 * ```
 * When `tool_name` is omitted, the invocation `action` is used as the MCP tool
 * name (so one entity can drive every tool on an MCP server).
 *
 * The command is validated against the `ALLOWED_CLI_COMMANDS` allowlist.
 */
async function invokeMcpStdio(
  entity: EntityForInvocation,
  action: string,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const command = config.command as string | undefined;
  const toolName = (config.tool_name as string | undefined) ?? action;

  if (!command) {
    return failResult('invocation_config.command is required for mcp_stdio', Date.now() - start);
  }
  if (!toolName) {
    return failResult('invocation_config.tool_name or an action is required for mcp_stdio', Date.now() - start);
  }

  // Validate command against allowlist
  if (!ALLOWED_CLI_COMMANDS.has(command)) {
    return failResult(
      `Command "${command}" is not in the allowed command list. ` +
      `Allowed: ${[...ALLOWED_CLI_COMMANDS].join(', ')}`,
      Date.now() - start,
    );
  }

  // Validate args: must be string array with no dangerous patterns (items 9-10)
  const argsValidation = validateArgs(config.args ?? []);
  if (!argsValidation.valid) {
    return failResult(`MCP stdio args validation failed: ${argsValidation.error}`, Date.now() - start);
  }
  const args = argsValidation.sanitized;
  const timeoutMs = resolveTimeoutMs(entity, options);

  // Standard MCP handshake + the tool call, batched on stdin. Servers that
  // skip the handshake still respond to tools/call, so the response is matched
  // by request id (1) with a fallback to the last JSON-RPC message.
  const protocolVersion = (config.protocol_version as string) ?? '2024-11-05';
  const jsonRpcRequest = [
    JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'draymond-invoker', version: '1.0.0' },
      },
    }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: input,
      },
    }),
  ].join('\n') + '\n';

  const execOptions: import('node:child_process').ExecFileOptions = {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
    encoding: 'utf8',
    env: { ...process.env },
  };
  if (typeof config.cwd === 'string' && config.cwd) {
    execOptions.cwd = config.cwd;
  }

  return new Promise<InvocationResult>((resolve) => {
    const child = execFile(
      command,
      args,
      execOptions,
      (error, stdout, stderr) => {
        const duration_ms = Date.now() - start;

        if (error) {
          const errorMsg = error.killed
            ? `MCP stdio process timed out after ${timeoutMs}ms`
            : `MCP stdio process failed: ${error.message}${stderr ? ` â€” stderr: ${stderr.slice(0, 500)}` : ''}`;
          resolve(failResult(errorMsg, duration_ms));
          return;
        }

        const stdoutText = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
        const stderrText = typeof stderr === 'string' ? stderr : stderr.toString('utf8');

        // Parse the JSON-RPC response from stdout
        const trimmedOut = stdoutText.trim();

        // Empty stdout means the process produced no output â€” protocol failure (item 13)
        if (!trimmedOut) {
          resolve(failResult('MCP stdio process returned empty stdout â€” no JSON-RPC response', duration_ms));
          return;
        }

        // The server answers the initialize + tools/call requests (possibly
        // more). Parse every line and pick the response for the tools/call
        // request (id 1); fall back to the last JSON-RPC message for servers
        // that skip the handshake.
        let rpcResponse: Record<string, unknown> | null = null;
        let lastMessage: Record<string, unknown> | null = null;
        for (const line of trimmedOut.split('\n')) {
          const parsed = safeParseJson(line.trim());
          if (parsed && parsed.jsonrpc === '2.0') {
            lastMessage = parsed;
            if (parsed.id === 1) rpcResponse = parsed;
          }
        }
        rpcResponse = rpcResponse ?? lastMessage;

        if (!rpcResponse) {
          resolve(failResult('MCP stdio process returned no parseable JSON-RPC response', duration_ms));
          return;
        }

        // Check for JSON-RPC error
        if (rpcResponse.error) {
          const rpcError = rpcResponse.error as Record<string, unknown>;
          resolve(failResult(
            `MCP JSON-RPC error: ${rpcError.message ?? JSON.stringify(rpcError)}`,
            duration_ms,
          ));
          return;
        }

        // Extract result.content per MCP protocol format
        const result = rpcResponse.result as Record<string, unknown> | undefined;
        const output: Record<string, unknown> = result?.content
          ? { content: result.content }
          : result ?? rpcResponse;

        if (stderrText.trim()) {
          output._stderr = stderrText.trim();
        }

        resolve({ success: true, output, duration_ms });
      },
    );

    // Write JSON-RPC request to stdin (item 11: fail explicitly if stdin unavailable)
    if (child.stdin) {
      safeWriteStdin(child, jsonRpcRequest);
    } else {
      // stdin is null — cannot send the request, fail immediately
      resolve(failResult('MCP stdio process stdin is not available — cannot send JSON-RPC request', Date.now() - start));
    }
  });
}
