// Server-only offline speech models. The model files are downloaded once by
// scripts/setup-local-models.sh and never cross the browser boundary.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { OfflineRecognizer, OfflineTts } from "sherpa-onnx-node";

const MODEL_ROOT = join(process.cwd(), "models");
const ASR_ROOT = join(MODEL_ROOT, "sherpa-onnx-moonshine-tiny-en-int8");
const TTS_ROOT = join(MODEL_ROOT, "vits-piper-en_US-lessac-medium");

let recognizerPromise: Promise<OfflineRecognizer> | null = null;
let ttsPromise: Promise<OfflineTts> | null = null;

function requireModel(path: string): void {
  if (!existsSync(path)) {
    throw new Error("Local voice model missing. Run scripts/setup-local-models.sh first.");
  }
}

function recognizer(): Promise<OfflineRecognizer> {
  requireModel(join(ASR_ROOT, "encode.int8.onnx"));
  recognizerPromise ??= OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      moonshine: {
        preprocessor: join(ASR_ROOT, "preprocess.onnx"),
        encoder: join(ASR_ROOT, "encode.int8.onnx"),
        uncachedDecoder: join(ASR_ROOT, "uncached_decode.int8.onnx"),
        cachedDecoder: join(ASR_ROOT, "cached_decode.int8.onnx"),
      },
      tokens: join(ASR_ROOT, "tokens.txt"),
      numThreads: 2,
      provider: "cpu",
      debug: 0,
    },
  }).catch((error: unknown) => {
    recognizerPromise = null;
    throw error;
  });
  return recognizerPromise;
}

function speechSynthesizer(): Promise<OfflineTts> {
  requireModel(join(TTS_ROOT, "en_US-lessac-medium.onnx"));
  ttsPromise ??= OfflineTts.createAsync({
    model: {
      vits: {
        model: join(TTS_ROOT, "en_US-lessac-medium.onnx"),
        tokens: join(TTS_ROOT, "tokens.txt"),
        dataDir: join(TTS_ROOT, "espeak-ng-data"),
      },
      numThreads: 2,
      provider: "cpu",
      debug: false,
    },
    maxNumSentences: 1,
  }).catch((error: unknown) => {
    ttsPromise = null;
    throw error;
  });
  return ttsPromise;
}

async function decodeToPcm(audio: Buffer): Promise<Float32Array> {
  const chunks: Buffer[] = [];
  const ffmpeg = spawn("ffmpeg", [
    "-v", "error", "-i", "pipe:0", "-t", "120", "-ac", "1", "-ar", "16000",
    "-f", "f32le", "pipe:1",
  ]);
  ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  ffmpeg.stdin.on("error", () => {});
  ffmpeg.stdin.end(audio);
  const exitCode = await new Promise<number>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error("Could not decode recorded audio. Check that ffmpeg is installed.");
  }
  const pcm = Buffer.concat(chunks);
  return new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
}

export async function transcribeLocalAudio(audio: Buffer): Promise<string> {
  const model = await recognizer();
  const samples = await decodeToPcm(audio);
  const stream = model.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples });
  const result = await model.decodeAsync(stream);
  return result.text.trim();
}

function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    wav.writeInt16LE(Math.round(clipped * 32767), 44 + i * 2);
  }
  return wav;
}

export async function synthesizeLocalSpeech(text: string): Promise<Buffer> {
  const model = await speechSynthesizer();
  const audio = await model.generateAsync({ text, sid: 0, speed: 1 });
  return encodeWav(audio.samples, audio.sampleRate);
}
