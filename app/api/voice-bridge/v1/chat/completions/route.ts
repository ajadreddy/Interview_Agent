import { NextResponse, type NextRequest } from "next/server";
import { nextVoicePart, publishVoiceTranscript } from "@/lib/voice-bridge";

export const runtime = "nodejs";

type CompletionRequest = {
  model?: string;
  stream?: boolean;
  messages?: Array<{ role?: string; content?: string }>;
};

export async function POST(req: NextRequest) {
  const bridgeKey = process.env.S2S_BRIDGE_KEY;
  if (!bridgeKey) return NextResponse.json({ error: "Voice bridge is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${bridgeKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: CompletionRequest;
  try {
    body = (await req.json()) as CompletionRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const instructions = body.messages?.filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : "")
    .join("\n") ?? "";
  const sessionId = /VOICE_SESSION_ID=([0-9a-f-]{36})/i.exec(instructions)?.[1];
  if (!sessionId) {
    // The Hugging Face backend probes its LLM once before accepting sessions.
    if (body.messages?.length === 2 && body.messages[0]?.content === "You are a helpful assistant" &&
        body.messages[1]?.content === "Hello") {
      return NextResponse.json({
        id: `chatcmpl-${crypto.randomUUID()}`, object: "chat.completion",
        created: Math.floor(Date.now() / 1000), model: body.model ?? "interviewer-voice-bridge",
        choices: [{ index: 0, message: { role: "assistant", content: "Ready." }, finish_reason: "stop" }],
      });
    }
    return NextResponse.json({ error: "Missing voice session" }, { status: 400 });
  }
  const userMessages = body.messages?.filter((message) => message.role === "user") ?? [];
  const latestUser = userMessages.at(-1)?.content;
  if (typeof latestUser === "string" && latestUser.trim()) {
    publishVoiceTranscript(sessionId, latestUser.trim(), userMessages.length);
  }
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const model = body.model ?? "interviewer-voice-bridge";
  if (!body.stream) {
    const pieces: string[] = [];
    try {
      while (true) {
        const part = await nextVoicePart(sessionId);
        if (part.type === "done") break;
        pieces.push(part.text);
      }
    } catch {
      return NextResponse.json({ error: "Interview reply timed out" }, { status: 504 });
    }
    return NextResponse.json({
      id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: "assistant", content: pieces.join("") }, finish_reason: "stop" }],
    });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": waiting\n\n")), 5_000);
      const emit = (delta: Record<string, string>, finish_reason: string | null) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
          model, choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`));
      };
      emit({ role: "assistant" }, null);
      try {
        while (true) {
          const part = await nextVoicePart(sessionId);
          if (part.type === "done") break;
          emit({ content: part.text }, null);
        }
        emit({}, "stop");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch {
        clearInterval(heartbeat);
        controller.error(new Error("Interview reply timed out"));
        return;
      }
      clearInterval(heartbeat);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}
