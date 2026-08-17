import { callLLM } from "@overlay365/fleet-client";
const code = "function getUser(id) { return db.query('SELECT * FROM users WHERE id = ' + id); }";
const prompt = `Review this for bugs/security only. Return JSON array with fields title,severity,description,file,line,fixSuggestion.\nCode:\n${code}`;
callLLM({ provider: "opencode", system: "Return only a valid JSON array.", userMessage: prompt, maxTokens: 6000, timeoutMs: 180_000 })
  .then((t) => console.log("OK:", t.slice(0, 400)))
  .catch((e) => console.log("ERR:", e.message));
