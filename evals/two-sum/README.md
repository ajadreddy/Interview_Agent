# Two Sum fixed-history evaluation

This evaluation freezes the conversation and app-owned state just before one candidate reply. It sends that reply through the existing `POST /api/interviewer` endpoint and captures the actual model response. The production prompt, agent route, and UI are unchanged.

## Run

Start Ollama with the installed `mock-coding-local` model, then start the app with `npm run dev`. In another terminal:

```bash
node --test evals/two-sum/checks.test.mjs
node evals/two-sum/run.mjs --ids approach-01
node evals/two-sum/run.mjs --repeat 2
```

The runner writes `report.json` and `summary.md` under `evals/two-sum/results/` (ignored by Git). Use `--output /path/to/directory` for another location. `--url` changes the app base URL; `--model` selects one of the route's existing preset IDs. For a cloud preset, set `EVAL_PROVIDER_KEY` in the runner environment or configure the app server's provider key. Do not commit result files that contain private candidate data.

The first full local baseline is versioned under `baselines/2026-10-20/`; `baseline-observations.md` records preliminary qualitative findings from those replies. The baseline report contains only synthetic candidate text and local model outputs.

To reapply updated deterministic checks to previously recorded **real** replies without calling the model again, use `--recheck /path/to/report.json --output /path/to/new-results`.

Optional local semantic judging:

```bash
node evals/two-sum/run.mjs --judge-model your-ollama-judge-model --judge-url http://127.0.0.1:11434
```

The judge uses Ollama's `/api/chat` JSON mode with temperature zero. It returns pass/fail/uncertain, evidence, and an explanation for six criteria. These are **model-generated assessments**, never ground truth; review disputed cases by hand. The interviewer route does not expose temperature, so the report records its route default rather than claiming a fixed value.

## Dataset

`scenarios.json` contains exactly 40 frozen scenarios across clarification (5), approach (7), hint leakage (6), misconception (6), memory (6), progression (5), and coding (5). Every item specifies the prior messages, latest candidate message, supported state overrides, optional code and visible/aggregate test result snapshot, expected and forbidden behaviors, expected phase signal, and rationale. The runner constructs the actual public Two Sum question fields from `data/questions.demo.json`; `/api/interviewer` injects its server-only interviewer context. Hidden inputs and expected outputs never enter the replay request or report.

| Field | Meaning |
|---|---|
| `scenario_id`, `category`, `description`, `problem_id` | Identity and coverage |
| `initial_phase`, `conversation_history`, `candidate_message` | Frozen turn presented to the real route |
| `interview_state` | Overrides limited to existing `SessionState` fields |
| `code_snapshot`, `test_results` | Optional evidence already owned by the app |
| `expected_behaviors`, `forbidden_behaviors`, `evaluation_rationale` | Semantic judging and human review labels |
| `expected_phase_behavior` | `stay`, `planning`, `coding`, `complete`, or `any` |
| `required_tools`, `forbidden_tools` | Optional deterministic tool checks |

Behavior labels describe acceptable properties, not exact wording. The deterministic checks cover transition tokens, question count, internal note leakage, and specified tool calls. They **do not** decide whether a probe is relevant or whether a hint reveals the solution; use the optional judge and human review for that. A failed deterministic check is evidence of a specific format or routing problem, not a complete interview-quality score.

## Replay limits

This is intentionally **one reply per fixed history**. It does not feed the model's answer into another scenario or reproduce browser-owned phase transitions, round-clock backstops, audio transcription, Judge0 Submit, or final feedback. `run_tests` remains a real route tool if the model chooses it; the runner does not invent execution results. Scenario test snapshots represent prior app-owned results and expose only visible cases plus hidden aggregate counts. Current failures and successes are measured against the prompt and policy currently in the repo, including its bounded post-pass review and optimization guidance.
