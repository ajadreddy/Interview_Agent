import { NextResponse, type NextRequest } from "next/server";
import { publishVoicePart } from "@/lib/voice-bridge";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { sessionId?: string; text?: string; done?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid voice reply" }, { status: 400 });
  }
  if (typeof body.sessionId !== "string" || (typeof body.text !== "string" && body.done !== true) || (body.text?.length ?? 0) > 8000) {
    return NextResponse.json({ error: "Invalid voice reply" }, { status: 400 });
  }
  try {
    if (body.text) publishVoicePart(body.sessionId, { type: "delta", text: body.text });
    if (body.done) publishVoicePart(body.sessionId, { type: "done" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid voice session" }, { status: 400 });
  }
}
