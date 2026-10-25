# Changes

## 2026-10-22 ? Unblock spoken interviewer replies

- `app/api/voice-bridge/v1/chat/completions/route.ts`, `app/api/voice-bridge/transcript/route.ts`, `lib/voice-bridge.ts`: deliver the speech server's confirmed user transcript to the browser as soon as its chat request arrives, and keep the streamed reply alive while the local interviewer generates. This removes the wait on a final transcription event that the speech server holds until its reply commits.
- `components/RealtimeVoice.tsx`: consume that transcript through the existing interview turn handler so the current prompt, editor state, Judge0 evidence, and feedback flow remain in use.
- `.env.local` (gitignored): use the installed `llama3.1:8b` model on this machine because the default `mock-coding-local` preset is not installed.

Lint: `npm run lint` passed with zero errors. Type check: `npx tsc --noEmit --incremental false` passed. A real WebSocket audio round trip delivered a transcribed utterance and reply audio. Browser smoke with a prerecorded microphone clip reached the interviewer route, displayed the transcript, and received streamed audio without page errors. Human microphone and speaker audibility still need a live check.

Smoke-test checklist:
- Refresh the interview page, start live voice, and speak after the opening reply. Confirm your words enter the chat and Alex answers aloud.
- Run a visible Judge0 test during coding and confirm voice remains connected and final feedback includes the coding transcript.

## 2026-10-22 — Start local voice reliably

- `scripts/start-realtime-voice.ps1`: creates the missing local bridge key, loads it into the speech process, detects the running Interview Agent port, and reports a clear setup error if the runtime or app is unavailable.
- `components/RealtimeVoice.tsx`, `README.md`, `.env.example`: made a failed connection actionable and aligned setup instructions with the launcher.

Lint: `npm run lint` passed with zero errors. Browser smoke reached Listening on port 3001 with no page errors; the live speech server accepted a WebSocket connection. No spoken interview or Judge0 run was performed.

Smoke-test checklist:
- Start `npm run dev`, then run `.\scripts\start-realtime-voice.ps1` in a second PowerShell terminal and wait for the Uvicorn startup line.
- Open the app URL, click Start live voice, and confirm Listening appears after microphone permission.
- Speak a turn and confirm both transcription and Alex's audio playback.

## 2026-10-22 — Live voice coding interview

- `app/api/voice-bridge/*`, `lib/voice-bridge.ts`: connected Hugging Face speech-to-speech audio output to the existing interviewer reply stream, with a local bridge key and per-session queues. The original interviewer route and prompt remain the conversation source.
- `components/RealtimeVoice.tsx`, `public/worklets/pcm-capture.js`, `components/InterviewWorkspace.tsx`, `components/ChatPanel.tsx`: added continuous microphone input and streamed voice playback while keeping the coding editor, Judge0 controls, transcript, and feedback flow in the same session.
- `lib/chat.ts`, `lib/coding-voice-report.ts`: tagged spoken candidate turns by phase so coding think-aloud reaches the final evidence report.
- `scripts/start-realtime-voice.ps1`, `scripts/setup-local-models.sh`, `.env.example`, `.gitignore`, `eslint.config.mjs`, `README.md`: documented and configured the local voice server and excluded downloaded Python models from lint.
- `lib/ai-models.ts`: allowed an installed Ollama model override when the default Qwen preset is unavailable.

Lint: `npm run lint` passed with zero errors. Type check: `npx tsc --noEmit --incremental false` passed. Browser smoke reached Listening with the editor visible and no page errors. Realtime WebSocket audio, bridge authentication, queued replies, and streamed response events passed protocol checks. A full spoken interview and Judge0/feedback path still need manual validation with the intended Qwen model; the installed older Ollama rejected its pull.

Smoke-test checklist:
- Start Ollama with the Qwen preset, run `npm run dev`, then start `scripts/start-realtime-voice.ps1` with the same `S2S_BRIDGE_KEY`.
- Open an interview, click Start live voice, speak a clarification and approach, and confirm Alex's replies are spoken while the transcript and phase advance.
- Enter code in Monaco, run visible tests, submit for hidden tests, and confirm the spoken coding transcript and test evidence appear in final feedback.
- Stop and restart live voice, then confirm the microphone and playback resume without an old reply.