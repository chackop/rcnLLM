import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

// ---- Provider-agnostic layer -------------------------------------------------
// The app only ever talks to /chat. Which model answers is a server concern,
// so keys stay off the device and providers can be swapped or failed over.

type Msg = { role: "user" | "assistant"; content: string };
interface Provider {
  name: string;
  stream(messages: Msg[], signal: AbortSignal): AsyncIterable<string>;
}

const anthropicProvider = (client: Anthropic): Provider => ({
  name: "claude",
  async *stream(messages, signal) {
    const s = client.messages.stream(
      {
        model: process.env.MODEL ?? "claude-haiku-5-5",
        max_tokens: 1024,
        messages,
      },
      { signal },
    );
    for await (const ev of s) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        yield ev.delta.text;
      }
    }
  },
});

// Lets the demo run with no API key, and doubles as a fallback provider.
const mockProvider: Provider = {
  name: "mock",
  async *stream(messages, signal) {
    const last = messages[messages.length - 1]?.content ?? "";
    const reply = `(mock model) You said: "${last}". Streaming works end to end: server-sent events from Node, rendered token by token in React Native.`;
    for (const word of reply.split(" ")) {
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, 40));
      yield word + " ";
    }
  },
};

const providers: Provider[] = [
  ...(process.env.ANTHROPIC_API_KEY
    ? [anthropicProvider(new Anthropic())]
    : []),
  mockProvider,
];

// ---- Tiny per-IP rate limit (swap for Redis/gateway in production) -----------
const hits = new Map<string, number[]>();
function rateLimited(ip: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

// ---- Route -------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.post("/chat", async (req, res) => {
  const messages: Msg[] | undefined = req.body?.messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    !messages.every(
      (m) =>
        (m?.role === "user" || m?.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length < 8000,
    )
  ) {
    return res.status(400).json({ error: "invalid messages" });
  }
  if (rateLimited(req.ip ?? "unknown")) {
    return res.status(429).json({ error: "slow down" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const ac = new AbortController();
  res.on("close", () => ac.abort()); // user left: stop paying for tokens

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Try providers in order; fall back only if nothing was streamed yet.
  for (const p of providers) {
    let started = false;
    try {
      for await (const chunk of p.stream(messages, ac.signal)) {
        started = true;
        send("token", { text: chunk });
      }
      send("done", { provider: p.name });
      return res.end();
    } catch (err) {
      console.error(`[${p.name}] failed`, err);
      if (started || ac.signal.aborted) break;
    }
  }
  send("error", { message: "model unavailable" });
  res.end();
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () =>
  console.log(
    `API on :${port} using [${providers.map((p) => p.name).join(" -> ")}]`,
  ),
);
