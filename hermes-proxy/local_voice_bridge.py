"""
Local voice bridge for the Hermes voice proxy.

Serves two operations invoked by the Node proxy (hermes-proxy/server.js)
when the AetherDesk upstream is unavailable or unconfigured:

  synthesize <text>            -> WAV/MP3 audio, base64 on stdout (JSON)
  transcribe  <audio-file>     -> transcript text on stdout (JSON)

TTS:  edge-tts (free Microsoft neural voices, no API key)
STT:  faster-whisper with the local tiny/base model cache (no cloud)

Usage (from hermes-proxy/server.js):
  python local_voice_bridge.py synthesize "Hello world" [voice]
  python local_voice_bridge.py transcribe C:\\path\\to\\audio.wav
"""
import base64
import io
import json
import os
import struct
import sys

# ---------------------------------------------------------------------------
# TTS: edge-tts
# ---------------------------------------------------------------------------
def synthesize(text, voice="en-US-AriaNeural"):
    import asyncio
    import edge_tts

    async def _run():
        communicate = edge_tts.Communicate(text, voice)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        return buf.getvalue()

    audio = asyncio.run(_run())
    if not audio:
        raise RuntimeError("edge-tts produced no audio")
    return {
        "audio": base64.b64encode(audio).decode("ascii"),
        "format": "audio/mpeg",
        "bytes": len(audio),
        "voice": voice,
        "engine": "edge-tts",
    }


# ---------------------------------------------------------------------------
# STT: faster-whisper (local model cache)
# ---------------------------------------------------------------------------
def _wav_header(data_len: int, sample_rate: int = 16000, channels: int = 1, bits: int = 16) -> bytes:
    """Build a minimal RIFF/WAVE header for raw PCM so faster-whisper (via
    ffmpeg) can decode it. Open-Chat's voice util sends raw int16 PCM bytes."""
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    header = b"RIFF" + struct.pack("<I", 36 + data_len) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits)
    header += b"data" + struct.pack("<I", data_len)
    return header


def transcribe(audio_path, model_name="tiny"):
    from faster_whisper import WhisperModel

    # Detect container by magic bytes. Raw PCM (no RIFF header) needs a WAV
    # header prepended; anything else (mp3/wav/ogg) passes through untouched.
    with open(audio_path, "rb") as fh:
        head = fh.read(12)

    if head[:4] != b"RIFF":
        tmp_path = audio_path + ".wav"
        with open(audio_path, "rb") as raw, open(tmp_path, "wb") as out:
            data = raw.read()
            out.write(_wav_header(len(data)))
            out.write(data)
        audio_path = tmp_path

    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, info = model.transcribe(audio_path, language=None)
        text = "".join(seg.text for seg in segments).strip()
    finally:
        # The proxy deletes the original temp file; clean up our wrapper too.
        if audio_path.endswith(".wav") and audio_path != audio_path[:-4]:
            try:
                os.unlink(audio_path)
            except OSError:
                pass

    return {
        "text": text,
        "model": model_name,
        "language": info.language,
        "engine": "faster-whisper",
    }


def main():
    if len(sys.argv) < 3:
        sys.stderr.write(json.dumps({"error": "usage: local_voice_bridge.py synthesize|transcribe ..."}))
        sys.exit(2)

    op = sys.argv[1]
    try:
        if op == "synthesize":
            text = sys.argv[2]
            voice = sys.argv[3] if len(sys.argv) > 3 else "en-US-AriaNeural"
            result = synthesize(text, voice)
        elif op == "transcribe":
            result = transcribe(sys.argv[2])
        else:
            raise RuntimeError(f"unknown op: {op}")
        print(json.dumps(result))
    except Exception as exc:  # noqa: BLE001 - surface as JSON for the proxy
        sys.stderr.write(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
