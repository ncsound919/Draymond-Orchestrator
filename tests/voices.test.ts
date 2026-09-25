import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalEnv = { ...process.env };

let tempDir = '';
let piperDir = '';
let sampleWav = '';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

interface FakeProc {
  stdin: {
    write: (text: string) => void;
    end: () => void;
    on: (event: string, cb: () => void) => void;
  };
  stderr: { on: (event: string, cb: () => void) => void };
  on: (event: string, cb: (code?: number | Error) => void) => void;
  emit: (event: string, ...args: unknown[]) => boolean;
}

function fakeProc(exitCode: number, error?: Error): FakeProc {
  const proc = new EventEmitter();
  Object.assign(proc, {
    stdin: { write: () => {}, end: () => {}, on: () => {} },
    stderr: { on: () => {} },
  });
  setTimeout(() => {
    if (error) proc.emit('error', error);
    else proc.emit('close', exitCode);
  }, 0);
  return proc as unknown as FakeProc;
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draymond-voices-'));
  piperDir = path.join(tempDir, 'piper');
  await fs.mkdir(piperDir);
  sampleWav = path.join(tempDir, 'sample.wav');
  await fs.writeFile(sampleWav, 'RIFF....');
  process.env.DRAYMOND_REGISTRY_DIR = tempDir;
  delete process.env.VOICE_SAMPLE_WAV;
  delete process.env.PIPER_MODELS_DIR;
  mocks.spawn.mockReset();
});

afterEach(async () => {
  process.env = { ...originalEnv };
  vi.resetModules();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

async function loadVoices() {
  vi.resetModules();
  vi.doMock('node:child_process', () => ({ spawn: mocks.spawn }));
  return await import('../src/lib/draymond/voices');
}

describe('listVoices', () => {
  it('lists the five known voices', async () => {
    const mod = await loadVoices();
    const voices = await mod.listVoices();

    expect(voices).toHaveLength(5);
    expect(voices.map((v) => v.id)).toEqual([
      'user-clone',
      'piper-en-f',
      'piper-en-m',
      'piper-en-f2',
      'none',
    ]);
  });
});

describe('agentVoice', () => {
  it('marks the user clone configured when a sample wav exists', async () => {
    process.env.VOICE_SAMPLE_WAV = sampleWav;
    const mod = await loadVoices();
    const res = await mod.agentVoice('aetherdesk');

    expect(res.voice.id).toBe('user-clone');
    expect(res.voice.engine).toBe('xtts');
    expect(res.configured).toBe(true);
    expect(res.detail).toBe('clone model + sample ready');
  });

  it('marks the user clone unconfigured when the sample file is missing', async () => {
    process.env.VOICE_SAMPLE_WAV = path.join(tempDir, 'nope.wav');
    const mod = await loadVoices();
    const res = await mod.agentVoice('aetherdesk');

    expect(res.configured).toBe(false);
    expect(res.detail).toBe('voice-clone sample missing (set VOICE_SAMPLE_WAV)');
  });

  it('marks the user clone unconfigured when VOICE_SAMPLE_WAV is unset', async () => {
    const mod = await loadVoices();
    const res = await mod.agentVoice('aetherdesk');

    expect(res.configured).toBe(false);
    expect(res.detail).toBe('voice-clone sample missing (set VOICE_SAMPLE_WAV)');
  });

  it('marks a piper voice configured when the onnx model exists', async () => {
    await fs.writeFile(path.join(piperDir, 'en_US-lessac-medium.onnx'), 'onnx');
    process.env.PIPER_MODELS_DIR = piperDir;
    const mod = await loadVoices();
    const res = await mod.agentVoice('overlay365-qa');

    expect(res.voice.id).toBe('piper-en-f');
    expect(res.configured).toBe(true);
    expect(res.detail).toBe('piper model en_US-lessac-medium found');
  });

  it('marks a piper voice unconfigured when the onnx model is missing', async () => {
    process.env.PIPER_MODELS_DIR = piperDir;
    const mod = await loadVoices();
    const res = await mod.agentVoice('overlay365-qa');

    expect(res.configured).toBe(false);
    expect(res.detail).toBe('piper model en_US-lessac-medium missing (set PIPER_MODELS_DIR)');
  });

  it('marks a piper voice unconfigured when PIPER_MODELS_DIR is unset', async () => {
    const mod = await loadVoices();
    const res = await mod.agentVoice('overlay365-qa');

    expect(res.configured).toBe(false);
    expect(res.detail).toContain('piper model en_US-lessac-medium missing');
  });

  it('falls back to the no-voice engine for unknown agents', async () => {
    const mod = await loadVoices();
    const res = await mod.agentVoice('ghost-agent');

    expect(res.voice.engine).toBe('none');
    expect(res.configured).toBe(false);
    expect(res.detail).toBe('no voice engine configured');
  });

  it('honors custom voice assignments from voices.json', async () => {
    await fs.writeFile(
      path.join(tempDir, 'voices.json'),
      JSON.stringify([{ agentId: 'aetherdesk', voiceId: 'piper-en-m' }]),
      'utf-8',
    );
    const mod = await loadVoices();
    const res = await mod.agentVoice('aetherdesk');

    expect(res.voice.id).toBe('piper-en-m');
    expect(res.voice.engine).toBe('piper');
  });

  it('falls back to the none voice for an unknown voice id', async () => {
    await fs.writeFile(
      path.join(tempDir, 'voices.json'),
      JSON.stringify([{ agentId: 'aetherdesk', voiceId: 'bogus' }]),
      'utf-8',
    );
    const mod = await loadVoices();
    const res = await mod.agentVoice('aetherdesk');

    expect(res.voice.id).toBe('none');
    expect(res.voice.engine).toBe('none');
  });
});

describe('synthesizeGreeting', () => {
  it('synthesizes a greeting with piper', async () => {
    await fs.writeFile(path.join(piperDir, 'en_US-lessac-medium.onnx'), 'onnx');
    await fs.writeFile(path.join(piperDir, 'en_US-lessac-medium.onnx.json'), '{}');
    process.env.PIPER_MODELS_DIR = piperDir;
    mocks.spawn.mockImplementation(() => fakeProc(0));

    const mod = await loadVoices();
    const outDir = path.join(tempDir, 'out');
    const res = await mod.synthesizeGreeting('overlay365-qa', 'hi there', outDir);

    expect(res.ok).toBe(true);
    expect(res.file).toBe(path.join(outDir, 'overlay365-qa.wav'));
    expect(res.detail).toBe('synthesized with en_US-lessac-medium');
    expect(mocks.spawn).toHaveBeenCalledWith(
      'python',
      [
        '-m',
        'piper',
        '-m',
        path.join(piperDir, 'en_US-lessac-medium.onnx'),
        '--config',
        path.join(piperDir, 'en_US-lessac-medium.onnx.json'),
        '-f',
        path.join(outDir, 'overlay365-qa.wav'),
      ],
    );
    const stat = await fs.stat(outDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('rejects when piper exits non-zero', async () => {
    await fs.writeFile(path.join(piperDir, 'en_US-lessac-medium.onnx'), 'onnx');
    process.env.PIPER_MODELS_DIR = piperDir;
    mocks.spawn.mockImplementation(() => fakeProc(1));

    const mod = await loadVoices();
    await expect(
      mod.synthesizeGreeting('overlay365-qa', 'hi', path.join(tempDir, 'out')),
    ).rejects.toThrow('piper exited 1');
  });

  it('rejects when piper fails to spawn', async () => {
    await fs.writeFile(path.join(piperDir, 'en_US-lessac-medium.onnx'), 'onnx');
    process.env.PIPER_MODELS_DIR = piperDir;
    mocks.spawn.mockImplementation(() => fakeProc(0, new Error('ENOENT')));

    const mod = await loadVoices();
    await expect(
      mod.synthesizeGreeting('overlay365-qa', 'hi', path.join(tempDir, 'out')),
    ).rejects.toThrow('ENOENT');
  });

  it('returns not-ok when the voice is not configured', async () => {
    const mod = await loadVoices();
    const res = await mod.synthesizeGreeting('aetherdesk', 'hi', path.join(tempDir, 'out'));

    expect(res.ok).toBe(false);
    expect(res.detail).toBe('voice-clone sample missing (set VOICE_SAMPLE_WAV)');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('returns not-ok for xtts synthesis until wired', async () => {
    process.env.VOICE_SAMPLE_WAV = sampleWav;
    const mod = await loadVoices();
    const res = await mod.synthesizeGreeting('aetherdesk', 'hi', path.join(tempDir, 'out'));

    expect(res.ok).toBe(false);
    expect(res.detail).toBe('engine xtts synthesis not wired yet');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('returns not-ok for the none engine', async () => {
    const mod = await loadVoices();
    const res = await mod.synthesizeGreeting('ghost-agent', 'hi', path.join(tempDir, 'out'));

    expect(res.ok).toBe(false);
    expect(res.detail).toBe('no voice engine configured');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
