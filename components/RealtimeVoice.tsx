"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, SessionPhase } from "@/lib/chat";

const SAMPLE_RATE = 24_000;
const SERVER_URL = process.env.NEXT_PUBLIC_S2S_WS_URL ?? "ws://127.0.0.1:8765/v1/realtime";

type Props = {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionPhase: SessionPhase;
  onTranscript: (text: string) => Promise<boolean>;
  sessionId: string;
  onStopped: () => void;
};

type RealtimeEvent = {
  type?: string;
  delta?: string;
  error?: { message?: string };
};

function encodePcm(samples: Float32Array, sourceRate: number): string {
  const count = Math.floor(samples.length * SAMPLE_RATE / sourceRate);
  const bytes = new Uint8Array(count * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) {
    const value = Math.max(-1, Math.min(1, samples[Math.floor(i * sourceRate / SAMPLE_RATE)]));
    view.setInt16(i * 2, Math.round(value * 32767), true);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodePcm(base64: string): Float32Array {
  const binary = atob(base64);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i));
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}

export function RealtimeVoice({ messages, isStreaming, sessionPhase, onTranscript, sessionId, onStopped }: Props) {
  const [status, setStatus] = useState("off");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<AudioWorkletNode | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlaybackRef = useRef(0);
  const publishedRef = useRef<string | null>(null);
  const voiceTurnRef = useRef(false);
  const latestMessagesRef = useRef(messages);
  const busyRef = useRef(isStreaming);
  const phaseRef = useRef(sessionPhase);
  const onTranscriptRef = useRef(onTranscript);
  const onStoppedRef = useRef(onStopped);

  useEffect(() => { latestMessagesRef.current = messages; }, [messages]);
  useEffect(() => { busyRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { phaseRef.current = sessionPhase; }, [sessionPhase]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onStoppedRef.current = onStopped; }, [onStopped]);

  function send(event: object) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(event));
    }
  }

  function stopPlayback() {
    for (const source of sourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    sourcesRef.current = [];
    nextPlaybackRef.current = 0;
  }

  function stop() {
    stopPlayback();
    captureRef.current?.disconnect();
    captureRef.current = null;
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    mediaRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    voiceTurnRef.current = false;
    onStoppedRef.current();
    setStatus("off");
  }

  useEffect(() => () => {
    if (socketRef.current) onStoppedRef.current();
    captureRef.current?.disconnect();
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    socketRef.current?.close();
    void contextRef.current?.close();
  }, []);

  const publishReply = useCallback(async (text: string) => {
    const res = await fetch("/api/voice-bridge/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, text, done: true }),
    });
    if (!res.ok) throw new Error("Could not send interviewer speech to the voice server");
  }, [sessionId]);

  useEffect(() => {
    if (status !== "listening" || isStreaming || sessionPhase === "feedback") return;
    const latest = [...messages].reverse().find((message) => message.role === "assistant" && message.content.trim());
    if (!latest || latest.id === publishedRef.current) return;
    publishedRef.current = latest.id;
    if (latest.content.startsWith("[Error:") || latest.content.startsWith("[Alex didn't respond")) {
      return;
    }
    const implicit = voiceTurnRef.current;
    voiceTurnRef.current = false;
    if (implicit) return;
    send({ type: "response.create" });
    void publishReply(latest.content).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [messages, isStreaming, sessionPhase, status, publishReply]);

  useEffect(() => {
    if (status !== "listening") return;
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`/api/voice-bridge/transcript?sessionId=${sessionId}`, { signal: controller.signal });
          if (response.status === 204) continue;
          if (!response.ok) throw new Error("Could not receive voice transcript");
          const { text } = (await response.json()) as { text: string };
          if (controller.signal.aborted) break;
          voiceTurnRef.current = true;
          const sent = await onTranscriptRef.current(text);
          if (!sent) { voiceTurnRef.current = false; send({ type: "response.cancel" }); }
        } catch (reason) {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
          break;
        }
      }
    })();
    return () => controller.abort();
  }, [status, sessionId]);

  async function start() {
    setError(null);
    setStatus("connecting");
    try {
      const context = new AudioContext({ latencyHint: "interactive" });
      contextRef.current = context;
      await context.resume();
      await context.audioWorklet.addModule("/worklets/pcm-capture.js");
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      mediaRef.current = media;
      const source = context.createMediaStreamSource(media);
      const capture = new AudioWorkletNode(context, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
      captureRef.current = capture;
      source.connect(capture);
      capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (busyRef.current || phaseRef.current === "feedback") return;
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: encodePcm(event.data, context.sampleRate) }));
        }
      };
      const socket = new WebSocket(SERVER_URL);
      socketRef.current = socket;
      socket.onopen = () => {
        send({ type: "session.update", session: {
          type: "realtime",
          instructions: `VOICE_SESSION_ID=${sessionId}`,
          output_modalities: ["audio"],
          audio: {
            input: { format: { type: "audio/pcm", rate: SAMPLE_RATE },
              transcription: { model: "whisper-1" },
              turn_detection: { type: "server_vad", interrupt_response: true } },
            output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
          },
        } });
        setStatus("listening");
      };
      socket.onmessage = (message: MessageEvent<string>) => {
        let event: RealtimeEvent;
        try { event = JSON.parse(message.data) as RealtimeEvent; } catch { return; }
        if (event.type === "input_audio_buffer.speech_started") stopPlayback();
        if (event.type === "response.output_audio.delta" && event.delta && contextRef.current) {
          const samples = decodePcm(event.delta);
          const audio = contextRef.current.createBuffer(1, samples.length, SAMPLE_RATE);
          audio.copyToChannel(Float32Array.from(samples), 0);
          const player = contextRef.current.createBufferSource();
          player.buffer = audio;
          player.connect(contextRef.current.destination);
          const at = Math.max(contextRef.current.currentTime, nextPlaybackRef.current);
          player.start(at);
          nextPlaybackRef.current = at + audio.duration;
          sourcesRef.current.push(player);
          player.onended = () => { sourcesRef.current = sourcesRef.current.filter((item) => item !== player); };
        }
        if (event.type === "error") setError(event.error?.message ?? "Voice server error");
      };
      socket.onerror = () => setError("Speech server is unavailable. Run .\\scripts\\start-realtime-voice.ps1 in the Interview_Agent repo.");
      socket.onclose = () => { if (socketRef.current === socket) { socketRef.current = null; stop(); } };
    } catch (reason) {
      stop();
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-300">
      <button type="button" onClick={status === "off" ? () => void start() : stop}
        className="rounded-md border border-sky-600 px-2 py-1 text-sky-200 hover:bg-sky-950/60">
        {status === "off" ? "Start live voice" : "Stop live voice"}
      </button>
      <span role="status">{error ?? (status === "listening" ? "Listening" : status === "connecting" ? "Connecting…" : "Voice off")}</span>
    </div>
  );
}
