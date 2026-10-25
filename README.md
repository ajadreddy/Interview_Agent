# Interview Agent


[![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

A voice-first coding interview simulator adapted from Mock Coding. You get a problem, talk through your approach out loud, write real code in a real editor, and an AI interviewer ("Alex") listens, pushes back, and writes a structured scorecard at the end grounded in what you actually did.

The point is everything a normal chat window can't do: a real editor, your code executed against **visible and hidden** test cases, voice think-aloud, code snapshots over time, and timing — all fed back into final feedback so it cites evidence instead of handing out generic praise.

Python-only execution. Local Ollama and offline voice by default; cloud models are optional. Built on Next.js + the Vercel AI SDK.

---

## What it does

A session moves through five phases. The interviewer drives the conversation; the app owns the phase (it controls the editor lock, timers, and which controls show).

1. **Clarifying** — editor locked. Alex presents the problem and answers clarifying questions.
2. **Planning** — editor still locked. You state an approach and its time/space complexity; Alex pushes on tradeoffs before letting you code.
3. **Coding** — editor unlocks. You write Python and run it against the visible examples. Live voice transcription follows each spoken turn; code snapshots are captured periodically (in memory).
4. **Follow-up** — after you submit, Alex grades hidden edge cases and asks a capped number of focused questions about your specific solution; solving cleanly can escalate the problem into a harder variant.
5. **Feedback** — a written scorecard streams in, built from the transcript, snapshots, test history, and pacing.

The editor is locked during clarifying/planning, unlocks at coding, and never re-locks.

---

## The idea

**The model owns the conversation. The app owns the evidence.**

A normal chat is already good at running a flexible clarify → approach → code → follow-up conversation. This app is worth building only because it gives the model things chat can't see: a real editor, Judge0 execution against visible *and* hidden tests, timing, voice think-aloud, solution snapshots, and feedback grounded in that evidence. So the conversation isn't scripted — one strong system prompt plus live state, and tools that only read evidence and run code.

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 |
| Editor | Monaco (`@monaco-editor/react`) |
| AI orchestration | Vercel AI SDK 6 (`streamText` + tool calling) |
| Interviewer / feedback models | Local Qwen3 4B via Ollama (default); Gemini 2.5 Flash, OpenAI GPT-5.4 Mini, Groq Llama 3.3 70B, Claude Sonnet 4.6 selectable in the chat panel (persisted to localStorage) |
| Voice in/out | [Hugging Face speech-to-speech](https://github.com/huggingface/speech-to-speech) over a local Realtime WebSocket |
| Code execution | Judge0 — Python 3 only; public CE endpoint by default, override via `JUDGE0_API_URL` |
| Limits / analytics | Upstash Redis — rate limiting, signup capture, funnel/rating stats, BYOK "at capacity" gate (all optional, fail-open) |
| Question bank | `data/questions.demo.json` (local, gitignored) |
| Persistence | localStorage — full session (chat, code, transcript, timers, run state) autosaved per question, restored on refresh, cleared after feedback or reset |

---

## Run it locally

```powershell
npm ci
# Start Ollama, then prepare the existing Qwen interviewer preset.
ollama pull qwen3:4b-instruct
ollama create mock-coding-local -f scripts/Modelfile
if (!(Test-Path data/questions.demo.json)) { Copy-Item data/questions.example.json data/questions.demo.json }
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install "speech-to-speech[pocket]==1.1.0"
# Terminal 1: npm run dev
# Terminal 2: ./scripts/start-realtime-voice.ps1
# The launcher creates .env.local and its bridge key, and detects Next on ports 3000-3010.
# Open the URL printed by npm run dev, start an interview, then click Start live voice.
```

**Question bank.** The app loads its questions from `data/questions.demo.json`
(gitignored — it's yours to fill in). Copy the tracked template
`data/questions.example.json` to `data/questions.demo.json` and replace the
placeholder with your own questions. The template documents the full schema:
`candidateDescription` is shown to the candidate, while `interviewerContext` and
every `hiddenTestCases` array are server-only grading data that never reach the
browser or get read aloud. A handful of questions with sharp hidden tests beats
many shallow ones.

The default AI path runs **locally without API keys**. If the Qwen pull reports that your Ollama version is too old, upgrade Ollama or set `OLLAMA_MODEL` in `.env.local` to an installed local model. Start Ollama before preparing the preset and running `npm run dev`; the app uses the `mock-coding-local` Ollama preset (Qwen3 4B with 32k context) for the interviewer and feedback. The interviewer remains in `/api/interviewer`; the voice server only transcribes speech and plays its replies. The live voice path uses Hugging Face speech-to-speech and does not need Moonshine or Piper model downloads.

Cloud interviewer models remain optional in the Advanced model menu. Their provider keys can be set in `.env.local` or in the **API Keys** drawer, which appears only when a cloud model is selected. The speech-to-speech server and interviewer run locally by default.

See `.env.example` for optional overrides such as `OLLAMA_BASE_URL`, Judge0 auth, and analytics. The local default bypasses the cloud demo's at-capacity key gate. Judge0 code execution still uses its configured endpoint.

---

## Project structure

```
app/
  page.tsx                      landing page
  questions/page.tsx            question browser
  interview/[questionId]/         interview session (page + loading)
  at-capacity/page.tsx            BYOK "at capacity" gate
  api/
    interviewer/route.ts        the single interviewer brain — every conversational turn
    feedback/route.ts             final grounded scorecard generation
    judge0/route.ts               Judge0 code-execution proxy
    voice-bridge/               passes interviewer replies to the speech server
    rating, signup, stats         funnel + analytics endpoints (Upstash-backed)

components/
  InterviewWorkspace.tsx        owns session state, phase transitions, timers (UI)
  ChatPanel.tsx                 conversation transcript, model picker, BYOK trigger
  RealtimeVoice.tsx             microphone stream and streamed audio playback
  Editor.tsx                    Monaco wrapper
  TestResultsPanel.tsx, ResizableTestResultsSection.tsx   run results
  FeedbackScreen.tsx, ScorecardWidget.tsx                 final feedback
  AssistantMessageBody.tsx      markdown rendering of Alex's messages
  ByokDrawer.tsx, ByokGate.tsx, AtCapacity.tsx            BYOK keys + capacity gate
  QuestionBrowser.tsx, ChatToggleButton.tsx, ErrorBoundary.tsx

lib/
  interviewer-prompt.ts         system prompt + per-turn context assembly
  interviewer-tools.ts          grounding tools (read code / transcript / tests, run tests)
  interviewer-model.ts          provider/model resolution for a turn
  feedback.ts                   evidence assembly + final feedback generation
  ai-models.ts, providers/*     model presets + per-provider adapters
  ai-client.ts, ai-errors.ts, resolve-provider-key.ts   client fetch, error mapping, server key resolution
  byok.ts, byok-mode.ts         BYOK storage + at-capacity mode
  judge0.ts                     code execution (batched submissions)
  voice-bridge.ts, coding-voice-report.ts             speech reply bridge and voice evidence summary
  session-state.ts, phase-config.ts, chat.ts            session types + phase budgets
  round-config.ts, interview-limits.ts, follow-up-config.ts,
  coding-escalation.ts, planning-coding-invite.ts       pacing, limits, follow-up + phase-transition helpers
  questions.ts                  question-bank loader
  interview-session-storage.ts, snapshots.ts            session persistence + code snapshots
  stats.ts                      Upstash-backed counters
  hooks/                        usePersistedState, useGroqAmbient, useFocusMicRecorder,
                                useCodeAutosave, useCodingShortcuts, useTickInterval,
                                useInterviewSessionAutosave

data/
  questions.demo.json           your local question bank (gitignored)
  questions.example.json        tracked schema template
public/
  og.png                        Open Graph preview image
```

---

## Docs

- [`docs/PROJECT-NOTES.md`](./docs/PROJECT-NOTES.md) — architecture and design in depth
- [`CLAUDE.md`](./CLAUDE.md), [`AGENTS.md`](./AGENTS.md) — conventions for AI coding assistants working in this repo

---

## Notes

- **No automated test suite.** `npm run lint` is the gate; verify the interview loop by running it end-to-end with `npm run dev`.
- **Python only.** Judge0 runs the candidate's Python (language 71) against visible and hidden cases; hidden inputs/expected values never reach the browser or the model.
