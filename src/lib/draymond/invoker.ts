// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Entity Invocation Bridge
// ============================================================================
// Takes an entity's invocation_method and invocation_config and actually
// calls the agent/tool/service. This replaces the `invocation_ready` stubs
// in the chain execution engine with real remote/local invocations.
// ============================================================================

import { execFile } from 'child_process';

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
      return invokeInternal(entity);
    case 'manual':
      return invokeManual(entity);
    case 'python_module':
      return invokePythonModule(entity, input, options);
    case 'mcp_tool':
      return invokeMcpTool(entity, input, options);
    case 'mcp_stdio':
      return invokeMcpStdio(entity, input, options);
    default:
      throw new Error(
        `Unsupported invocation method "${method}" for entity "${entity.name}" (${entity.slug}). ` +
        `Supported methods: http_api, api_call, subprocess, cli_command, webhook, internal, manual, python_module, mcp_tool, mcp_stdio.`,
      );
  }
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
 * Validate that a URL does not point to private/internal IP ranges (SSRF protection).
 * Blocks: 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, [::1], localhost, 0.0.0.0
 *
 * In development (NODE_ENV !== 'production'), localhost and private IPs are
 * ALLOWED because the entire agent fleet runs locally. Set ALLOW_LOCAL_AGENTS=1
 * to explicitly allow localhost in any environment.
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

  // In development or when ALLOW_LOCAL_AGENTS is set, skip private IP checks.
  // The agent fleet runs on localhost during local development.
  const allowLocal =
    process.env.NODE_ENV !== 'production' ||
    process.env.ALLOW_LOCAL_AGENTS === '1' ||
    process.env.ALLOW_LOCAL_AGENTS === 'true';

  if (allowLocal) {
    return { valid: true };
  }

  const hostname = parsed.hostname.toLowerCase();

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
  const url = config.url as string | undefined;

  if (!url) {
    return failResult('invocation_config.url is required for http_api', Date.now() - start);
  }

  // SSRF protection: block private/internal IPs
  const urlCheck = validateUrlNotPrivate(url);
  if (!urlCheck.valid) {
    return failResult(`SSRF blocked: ${urlCheck.error}`, Date.now() - start);
  }

  const method = ((config.method as string) || 'POST').toUpperCase();
  const configHeaders = (config.headers ?? {}) as Record<string, string>;
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
      fetchOptions.body = JSON.stringify({ action, ...input });
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timer);

    const duration_ms = Date.now() - start;
    const bodyText = await response.text();
    const output = safeParseJson(bodyText);

    if (options?.include_raw) {
      output._raw = bodyText;
    }

    return {
      success: response.ok,
      output,
      error: response.ok ? undefined : `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      duration_ms,
      status_code: response.status,
    };
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

  const configHeaders = (config.headers ?? {}) as Record<string, string>;
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
    clearTimeout(timer);

    const duration_ms = Date.now() - start;
    const bodyText = await response.text();
    const output = safeParseJson(bodyText);

    if (options?.include_raw) {
      output._raw = bodyText;
    }

    return {
      success: response.ok,
      output,
      error: response.ok ? undefined : `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      duration_ms,
      status_code: response.status,
    };
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
            : `Process exited with error: ${error.message}${stderr ? ` — stderr: ${stderr.slice(0, 500)}` : ''}`;
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

    // Write input to stdin
    if (child.stdin) {
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
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
            : `Command failed: ${error.message}${stderr ? ` — stderr: ${stderr.slice(0, 500)}` : ''}`;
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

  const configHeaders = (config.headers ?? {}) as Record<string, string>;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...configHeaders,
    ...options?.extra_headers,
  };

  // Webhooks use a short timeout — we only care about delivery acknowledgement
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
 * Returns immediately with a status marker.
 */
function invokeInternal(entity: EntityForInvocation): Promise<InvocationResult> {
  return Promise.resolve({
    success: true,
    output: {
      status: 'internal',
      message: 'Internal entity — no remote invocation needed',
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
 * automatically — it returns a marker so the chain engine can surface
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

  return new Promise<InvocationResult>((resolve) => {
    const child = execFile(
      'python',
      ['-c', script],
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        const duration_ms = Date.now() - start;

        if (error) {
          const errorMsg = error.killed
            ? `Python process timed out after ${timeoutMs}ms`
            : `Python execution failed: ${error.message}${stderr ? ` — stderr: ${stderr.slice(0, 500)}` : ''}`;
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

    if (child.stdin) {
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
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
 * MCP server implementations (item 12 — documented as intentional).
 *
 * The `action` parameter from the step is included in the request body
 * (item 15 — previously silently ignored).
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

  const configHeaders = (config.headers ?? {}) as Record<string, string>;
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
    clearTimeout(timer);

    const duration_ms = Date.now() - start;
    const bodyText = await response.text();
    const output = safeParseJson(bodyText);

    if (options?.include_raw) {
      output._raw = bodyText;
    }

    return {
      success: response.ok,
      output,
      error: response.ok ? undefined : `MCP tool HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      duration_ms,
      status_code: response.status,
    };
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
 * Invokes an MCP tool via a JSON-RPC request over stdin/stdout. Spawns the
 * MCP server as a child process, writes a JSON-RPC `tools/call` request to
 * stdin, and reads the JSON-RPC response from stdout.
 *
 * Expects `invocation_config` to have:
 * ```
 * { command: string, args?: string[], tool_name: string }
 * ```
 *
 * The command is validated against the `ALLOWED_CLI_COMMANDS` allowlist.
 */
async function invokeMcpStdio(
  entity: EntityForInvocation,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const start = Date.now();
  const config = entity.invocation_config;
  const command = config.command as string | undefined;
  const toolName = config.tool_name as string | undefined;

  if (!command) {
    return failResult('invocation_config.command is required for mcp_stdio', Date.now() - start);
  }
  if (!toolName) {
    return failResult('invocation_config.tool_name is required for mcp_stdio', Date.now() - start);
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

  // Build JSON-RPC request per MCP protocol
  const jsonRpcRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: input,
    },
  });

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
            ? `MCP stdio process timed out after ${timeoutMs}ms`
            : `MCP stdio process failed: ${error.message}${stderr ? ` — stderr: ${stderr.slice(0, 500)}` : ''}`;
          resolve(failResult(errorMsg, duration_ms));
          return;
        }

        // Parse the JSON-RPC response from stdout
        const trimmedOut = stdout.trim();

        // Empty stdout means the process produced no output — protocol failure (item 13)
        if (!trimmedOut) {
          resolve(failResult('MCP stdio process returned empty stdout — no JSON-RPC response', duration_ms));
          return;
        }

        const rpcResponse = safeParseJson(trimmedOut);

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

        if (stderr && stderr.trim()) {
          output._stderr = stderr.trim();
        }

        resolve({ success: true, output, duration_ms });
      },
    );

    // Write JSON-RPC request to stdin (item 11: fail explicitly if stdin unavailable)
    if (child.stdin) {
      child.stdin.write(jsonRpcRequest);
      child.stdin.end();
    } else {
      // stdin is null — cannot send the request, fail immediately
      resolve(failResult('MCP stdio process stdin is not available — cannot send JSON-RPC request', Date.now() - start));
    }
  });
}
