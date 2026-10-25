import { NextResponse, type NextRequest } from "next/server";
import { nextVoiceTranscript } from "@/lib/voice-bridge";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "Missing voice session" }, { status: 400 });
  try {
    const text = await nextVoiceTranscript(sessionId);
    return text ? NextResponse.json({ text }) : new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Invalid voice session" }, { status: 400 });
  }
}
