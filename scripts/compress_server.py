"""Persistent LLMLingua-2 compressor service for Draymond.

Keeps the BERT compressor loaded in memory so prompts can be compressed
without re-loading the model on every call. Listens on port 3212.

  POST /compress  { "text": "...", "rate": 0.5, "question": "", "target": 0 }
  GET  /health    -> { status: "ok" }
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ["CUDA_VISIBLE_DEVICES"] = ""

PORT = int(os.environ.get("LLMLINGUA_PORT", "3212"))

_compressor = None

def get_compressor():
    global _compressor
    if _compressor is None:
        from llmlingua import PromptCompressor
        _compressor = PromptCompressor(
            model_name="microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
            use_llmlingua2=True,
            device_map="cpu",
        )
    return _compressor

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "model_loaded": _compressor is not None})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/compress":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            req = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            self._send(400, {"error": "invalid JSON"})
            return
        text = req.get("text", "")
        if not text:
            self._send(400, {"error": "text required"})
            return
        try:
            llm = get_compressor()
            question = req.get("question", "")
            target = int(req.get("target", 0) or 0)
            rate = float(req.get("rate", 0.5))
            if target > 0:
                r = llm.compress_prompt(text, instruction="", question=question, target_token=target)
            else:
                r = llm.compress_prompt(text, instruction="", question=question, rate=rate)
            self._send(200, {
                "original_tokens": r.get("origin_tokens"),
                "compressed_tokens": r.get("compressed_tokens"),
                "ratio": r.get("ratio"),
                "compressed_prompt": r["compressed_prompt"],
            })
        except Exception as e:
            self._send(500, {"error": str(e)})

    def log_message(self, *args):
        pass  # quiet

if __name__ == "__main__":
    print(f"LLMLingua-2 compressor on port {PORT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
