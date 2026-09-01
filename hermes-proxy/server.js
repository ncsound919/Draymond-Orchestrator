/**
 * Hermes Gateway (port 8642) — agent with tools, memory, and skills,
 * speaking the OpenAI SSE contract Open-Chat's HermesClient expects.
 *
 * Run:  node hermes-proxy/server.js
 */
import http from 'node:http';

const PORT = Number(process.env.HERMES_PROXY_PORT || 8642);
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

export function sessionFromPayload(payload) {
  const s = payload?.metadata?.session_id;
  return typeof s === 'string' && s.trim() ? s.trim() : 'default';
}

export function sseChunk(content) {
  const payload = JSON.stringify({
    choices: [{ delta: { content }, finish_reason: null }],
  });
  return `data: ${payload}\n\n`;
}

export function sseDone() {
  return 'data: [DONE]\n\n';
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/**
 * Run the local Python voice bridge (edge-tts / faster-whisper) and resolve
 * with its parsed JSON result. Rejects on non-zero exit or invalid output.
 */
async function runLocalVoice(bridge, pythonCmd, args) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    execFile(
      pythonCmd,
      [bridge, ...args],
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('Local voice bridge returned invalid output'));
        }
      }
    );
  });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error('Request body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
function setCors(req, res) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && LOOPBACK_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/v1/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // Static media (generated videos / voice) so the phone can fetch them
  // over the tunnel via /media/<file>.
  if (req.method === 'GET' && req.url.startsWith('/media/')) {
    const { createReadStream, existsSync } = await import('node:fs');
    const path = await import('node:path');
    const mediaDir =
      process.env.MEDIA_DIR || path.join(import.meta.dirname, 'media');
    const name = path.basename(req.url.slice('/media/'.length));
    const filePath = path.join(mediaDir, name);
    if (!existsSync(filePath)) {
      sendJson(res, 404, { error: { message: 'Not found' } });
      return;
    }
    const ext = path.extname(name).toLowerCase();
    const mime =
      ext === '.mp4' ? 'video/mp4' : ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Disposition': `inline; filename="${name}"` });
    createReadStream(filePath).pipe(res);
    return;
  }

  // Voice proxy — lets Open-Chat's phone UI use TTS/STT through the gateway
  // (which holds AETHERDESK_* keys server-side) so no key ships in the APK.
  // Matches the /api/v1/voice/* path Open-Chat's voice util builds when the
  // bot host is this gateway (voiceBackend "draymond" → host + /api/v1/voice).
  // Falls back to the fully-local Python bridge (edge-tts + faster-whisper)
  // when AetherDesk is unconfigured or unreachable, so voice keeps working
  // with zero cloud dependencies.
  if (req.method === 'POST' && (req.url === '/api/v1/voice/synthesize' || req.url === '/api/v1/voice/transcribe')) {
    const isSynth = req.url.endsWith('/synthesize');
    const aetherdesk = process.env.AETHERDESK_BASE_URL || 'http://127.0.0.1:8000/api/v1';
    const key = process.env.AETHERDESK_API_KEY || '';
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      sendJson(res, e.status || 500, { error: { message: e.message } });
      return;
    }

    // Try the configured AetherDesk upstream first; fall back to local.
    if (key) {
      try {
        const upstream = await fetch(
          `${aetherdesk}/voice/${isSynth ? 'synthesize' : 'transcribe'}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': isSynth ? 'application/json' : 'application/octet-stream',
              'x-api-key': key,
            },
            body: isSynth ? body : body, // raw PCM passes through for transcribe
            signal: AbortSignal.timeout(90_000),
          }
        );
        const text = await upstream.text();
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        res.end(text);
        return;
      } catch {
        // AetherDesk unreachable — fall through to local voice bridge.
      }
    }

    try {
      const { tmpdir } = await import('node:os');
      const pathMod = await import('node:path');
      const { promises: fsPromises, writeFileSync } = await import('node:fs');
      const bridge = pathMod.join(import.meta.dirname, 'local_voice_bridge.py');
      const pythonCmd = process.env.LOCAL_VOICE_PYTHON || 'python';

      let localResult;
      if (isSynth) {
        let text = '';
        try {
          const parsed = JSON.parse(body.toString('utf8'));
          text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
        } catch { /* fall through */ }
        if (!text) {
          sendJson(res, 400, { error: { message: 'Missing required field: text' } });
          return;
        }
        localResult = await runLocalVoice(bridge, pythonCmd, ['synthesize', text]);
      } else {
        // Persist raw PCM to a temp file and let faster-whisper read it.
        const tmpFile = pathMod.join(tmpdir(), `voice-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
        writeFileSync(tmpFile, body);
        try {
          localResult = await runLocalVoice(bridge, pythonCmd, ['transcribe', tmpFile]);
        } finally {
          fsPromises.unlink(tmpFile).catch(() => {});
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(localResult));
    } catch (e) {
      console.error('[voice] local bridge error:', e.message, '\n', e.stack || '');
      sendJson(res, 502, { error: { message: `Voice unavailable: ${e.message}` } });
    }
    return;
  }

  // The /v1/chat/completions role moved to the real Hermes api_server on 8642.
  // This gateway now only serves /v1/health, /media/*, and /api/v1/voice/*.
  sendJson(res, 404, { error: { message: 'Not found' } });
  return;
});

// Only auto-start when run directly (Node main module). Tests import the
// helpers without binding the port, so `npm test` never collides with a
// running gateway.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[hermes-gateway] Agent gateway on http://127.0.0.1:${PORT}`);
  });
}
