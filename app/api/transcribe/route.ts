import { type NextRequest, NextResponse } from "next/server";

import { transcribeLocalAudio } from "@/lib/local-speech";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "invalid_audio" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }
  const audioType = file.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.has(audioType) || file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "invalid_audio" }, { status: 400 });
  }

  try {
    const text = await transcribeLocalAudio(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
