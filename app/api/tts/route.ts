import { type NextRequest, NextResponse } from "next/server";

import { synthesizeLocalSpeech } from "@/lib/local-speech";

export const runtime = "nodejs";

const MAX_TEXT_CHARS = 4500;

type TtsRequestBody = { text?: unknown };

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: TtsRequestBody;
  try {
    body = (await req.json()) as TtsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  try {
    const audio = await synthesizeLocalSpeech(body.text.trim().slice(0, MAX_TEXT_CHARS));
    return new NextResponse(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local speech generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
