import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReply, validateScenarios } from "./checks.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function localModelDigest(model) {
  if (model !== "ollama-qwen3-4b-instruct") return null;
  try {
    const response = await fetch(`${(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const tags = await response.json();
    return tags.models?.find((entry) => entry.name === "mock-coding-local:latest")?.digest ?? null;
  } catch {
    return null;
  }
}

function options(argv) {
  const out = { url: "http://127.0.0.1:3000", model: "ollama-qwen3-4b-instruct", repeat: 1 };
  const allowed = new Set(["url", "model", "repeat", "ids", "output", "judge-model", "judge-url", "recheck"]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!key || !allowed.has(key) || !argv[i]?.startsWith("--") || !argv[i + 1]) throw new Error(`Invalid or unsupported argument ${argv[i]}`);
    out[key] = argv[i + 1];
  }
  out.repeat = Number(out.repeat);
  if (!Number.isInteger(out.repeat) || out.repeat < 1) throw new Error("--repeat must be a positive integer");
  return out;
}

function stateFor(scenario, question) {
  return {
    phase: scenario.initial_phase,
    editorLocked: ["clarifying", "planning"].includes(scenario.initial_phase),
    roundEndsAt: ["clarifying", "planning"].includes(scenario.initial_phase) ? null : Date.now() + 30 * 60 * 1000,
    followUpTurnsUsed: 0,
    testRunsUsed: 0,
    lastTestResult: scenario.test_results,
    currentCode: scenario.code_snapshot ?? question.starterCode,
    snapshots: [],
    topicsProbed: [],
    transcript: [],
    forcedWrap: false,
    followUpSegment: "final",
    activeFollowUp: null,
    question: {
      id: question.id,
      title: question.title,
      difficulty: question.difficulty,
      candidateDescription: question.candidateDescription,
      testCases: question.testCases,
      entryFunction: question.entryFunction,
      followUps: question.followUps?.map((followUp) => ({
        id: followUp.id,
        prompt: followUp.prompt,
        expectedMinutes: followUp.expectedMinutes,
        entryFunction: followUp.entryFunction,
        testCases: followUp.testCases,
      })),
    },
    ...scenario.interview_state,
  };
}

export function parseUiStream(raw) {
  const events = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    try { events.push(JSON.parse(data)); } catch { /* Ignore non-JSON SSE comments. */ }
  }
  const reply = events.filter((e) => e.type === "text-delta").map((e) => e.delta ?? "").join("");
  const starts = events.filter((e) => e.type === "tool-input-start");
  const calls = starts.length ? starts : events.filter((e) => e.type === "tool-input-available");
  const toolCalls = calls.map((e) => e.toolName).filter(Boolean);
  const namesById = new Map(calls.map((e) => [e.toolCallId, e.toolName]));
  const toolResults = events.filter((e) => e.type === "tool-output-available").map((e) => ({ tool: e.toolName ?? namesById.get(e.toolCallId) ?? null, output: e.output }));
  const errors = events.filter((e) => e.type === "data-error" || e.type === "error").map((e) => e.data?.message ?? e.errorText ?? "stream error");
  return { reply, toolCalls, toolResults, errors, events };
}

async function interviewerReply(url, model, scenario, question, key) {
  const messages = [...scenario.conversation_history, { role: "user", content: scenario.candidate_message }].map((m, i) => ({ id: `eval-${i}`, ...m }));
  const state = stateFor(scenario, question);
  const headers = { "content-type": "application/json" };
  if (key) headers["x-provider-key"] = key;
  const response = await fetch(`${url.replace(/\/$/, "")}/api/interviewer`, {
    method: "POST", headers,
    body: JSON.stringify({ sessionState: state, messages, transcript: state.transcript, turnCount: Math.floor(messages.length / 2), modelPresetId: model }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return parseUiStream(await response.text());
}

const criteria = ["probe_relevance", "non_leading_questioning", "reasoning_verification", "conversation_memory", "interview_progression", "technical_correctness"];

async function judgeReply(baseUrl, model, scenario, actual, question) {
  const prompt = `You are evaluating one fixed-history reply from a Two Sum coding interviewer. Evaluate the interviewer, not the candidate. Use the whole scenario, including prior turns. Multiple natural phrasings can pass. Do not reward verbosity. Distinguish missing evidence from a candidate misconception. A hint explicitly requested by the candidate may be appropriate. The current production policy accepts a stated brute-force plan, so do not penalize that by itself. Return JSON only: an object with keys ${criteria.join(", ")}; each value has status (pass, fail, or uncertain), evidence (short quote or observation), and explanation (one sentence). If the scenario does not test a criterion, mark uncertain. These are model-generated assessments, not ground truth.\n\nProblem context: ${question.candidateDescription}\nServer interviewer reference: ${question.interviewerContext}\n\nScenario and actual reply:\n${JSON.stringify({ scenario, actual: { reply: actual.reply, toolCalls: actual.toolCalls } }, null, 2)}`;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: false, format: "json", options: { temperature: 0 }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Judge HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const answer = JSON.parse((await response.json()).message?.content ?? "{}");
  for (const criterion of criteria) {
    if (!["pass", "fail", "uncertain"].includes(answer[criterion]?.status) || typeof answer[criterion]?.evidence !== "string" || typeof answer[criterion]?.explanation !== "string") {
      throw new Error(`Judge returned invalid ${criterion} result`);
    }
  }
  return answer;
}

function summary(results) {
  const counts = (rows) => Object.fromEntries(["pass", "fail", "uncertain"].map((status) => [status, rows.filter((x) => x === status).length]));
  const byCategory = {};
  for (const r of results) (byCategory[r.category] ??= []).push(r);
  const judgedFailures = (category, criterion) => results.filter((r) => r.category === category && r.judge?.[criterion]?.status === "fail").length;
  return {
    total: results.length,
    execution: counts(results.map((r) => r.execution_status)),
    deterministic: counts(results.map((r) => r.deterministic?.status ?? "uncertain")),
    judge: counts(results.flatMap((r) => r.judge ? Object.values(r.judge).map((v) => v.status) : [])),
    judge_errors: results.filter((r) => r.judge_error).length,
    human_reviewed_labels: 0,
    diagnostic_failures: {
      premature_hints: judgedFailures("hint_leakage", "non_leading_questioning"),
      reasoning_assessment: [...(byCategory.approach ?? []), ...(byCategory.misconception ?? [])].filter((r) => r.judge?.reasoning_verification?.status === "fail").length,
      repeated_questions: judgedFailures("memory", "conversation_memory"),
      phase_transitions: results.filter((r) => r.deterministic?.findings.some((f) => f.name === "phase_behavior" && f.status === "fail")).length,
    },
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([name, rows]) => [name, { total: rows.length, deterministic: counts(rows.map((r) => r.deterministic?.status ?? "uncertain")), judge: counts(rows.flatMap((r) => r.judge ? Object.values(r.judge).map((v) => v.status) : [])) }])),
  };
}

function markdown(report) {
  const lines = ["# Two Sum fixed-history baseline", "", `Date: ${report.metadata.date}`, `Interviewer preset: ${report.metadata.model}`, `Ollama digest: ${report.metadata.ollama_digest ?? "unavailable"}`, `Prompt SHA-256: ${report.metadata.prompt_sha256}`, `Architecture SHA-256: ${report.metadata.architecture_sha256}`, `Interviewer temperature: route default (not configurable through the current API)`, `Judge: ${report.metadata.judge_model ?? "disabled"} (model-generated assessment)`, "", `Scenarios attempted: ${report.summary.total}`, `Execution: ${JSON.stringify(report.summary.execution)}`, `Deterministic checks: ${JSON.stringify(report.summary.deterministic)}`, `Judge criterion results: ${JSON.stringify(report.summary.judge)}`, `Judge errors: ${report.summary.judge_errors}`, `Human-reviewed labels: ${report.summary.human_reviewed_labels}`, "", "## Diagnostic failures", "", `Premature hints (judge): ${report.metadata.judge_model ? report.summary.diagnostic_failures.premature_hints : "not assessed"}`, `Reasoning assessment (judge): ${report.metadata.judge_model ? report.summary.diagnostic_failures.reasoning_assessment : "not assessed"}`, `Repeated questions (judge): ${report.metadata.judge_model ? report.summary.diagnostic_failures.repeated_questions : "not assessed"}`, `Incorrect phase transitions (deterministic): ${report.summary.diagnostic_failures.phase_transitions}`, "", "| Category | Runs | Deterministic pass | Deterministic fail | Uncertain |", "|---|---:|---:|---:|---:|"];
  for (const [name, row] of Object.entries(report.summary.byCategory)) lines.push(`| ${name} | ${row.total} | ${row.deterministic.pass} | ${row.deterministic.fail} | ${row.deterministic.uncertain} |`);
  lines.push("", "## Representative failures", "");
  for (const r of report.results.filter((r) => r.execution_status === "fail" || r.deterministic?.status === "fail" || Object.values(r.judge ?? {}).some((v) => v.status === "fail")).slice(0, 12)) {
    lines.push(`### ${r.scenario_id}`, "", `Prior context: ${(r.conversation_history ?? []).map((m) => `${m.role}: ${m.content}`).join(" | ")}`, "", `Candidate: ${r.candidate_message}`, "", `Interviewer: ${r.reply || "(no reply)"}`, "", `Deterministic: ${r.deterministic?.findings.filter((f) => f.status === "fail").map((f) => `${f.name}: ${f.detail}`).join("; ") || r.error || "none"}`, "");
  }
  lines.push("## Limits", "", "Each case is one frozen reply. This does not replay browser-owned transitions or establish how the interviewer would respond to its own follow-up. Semantic judge results require human review; deterministic checks do not establish reasoning quality.", "");
  return lines.join("\n");
}

async function main() {
  const opts = options(process.argv.slice(2));
  const question = (await readJson(resolve(root, "data/questions.demo.json"))).find((q) => q.id === "two-sum");
  if (!question) throw new Error("Two Sum is missing from the question bank");
  const scenarios = await readJson(resolve(here, "scenarios.json"));
  validateScenarios(scenarios, question);
  if (opts.recheck) {
    const report = await readJson(resolve(opts.recheck));
    const byId = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
    for (const row of report.results) {
      const scenario = byId.get(row.scenario_id);
      if (!scenario) throw new Error(`Unknown recorded scenario ${row.scenario_id}`);
      if (row.reply) row.deterministic = checkReply(scenario, row.reply, row.toolCalls ?? [], row.events ?? []);
    }
    report.metadata.rechecked_at = new Date().toISOString();
    report.metadata.ollama_digest ??= await localModelDigest(report.metadata.model);
    report.summary = summary(report.results);
    const output = resolve(opts.output ?? resolve(here, "results", "rechecked"));
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    await writeFile(resolve(output, "summary.md"), markdown(report));
    process.stdout.write(`Rechecked recorded model replies: ${output}\n`);
    return;
  }
  const selected = opts.ids ? scenarios.filter((s) => opts.ids.split(",").includes(s.scenario_id)) : scenarios;
  if (!selected.length) throw new Error("No matching scenario IDs");
  const prompt = await readFile(resolve(root, "lib/interviewer-prompt.ts"));
  const route = await readFile(resolve(root, "app/api/interviewer/route.ts"));
  const tools = await readFile(resolve(root, "lib/interviewer-tools.ts"));
  const metadata = { date: new Date().toISOString(), model: opts.model, ollama_digest: await localModelDigest(opts.model), judge_model: opts["judge-model"] ?? null, prompt_sha256: createHash("sha256").update(prompt).digest("hex"), architecture_sha256: createHash("sha256").update(route).update(tools).update(JSON.stringify(question)).digest("hex"), repeat: opts.repeat, api_url: opts.url };
  const results = [];
  for (const scenario of selected) for (let attempt = 1; attempt <= opts.repeat; attempt++) {
    const row = { scenario_id: scenario.scenario_id, category: scenario.category, conversation_history: scenario.conversation_history, candidate_message: scenario.candidate_message, attempt, execution_status: "uncertain" };
    try {
      const actual = await interviewerReply(opts.url, opts.model, scenario, question, process.env.EVAL_PROVIDER_KEY);
      Object.assign(row, actual);
      row.execution_status = actual.errors.length || !actual.reply.trim() ? "fail" : "pass";
      row.deterministic = checkReply(scenario, actual.reply, actual.toolCalls, actual.events);
      if (opts["judge-model"]) {
        try {
          row.judge = await judgeReply(opts["judge-url"] ?? "http://127.0.0.1:11434", opts["judge-model"], scenario, actual, question);
        } catch (error) {
          row.judge_error = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      row.execution_status = "fail";
      row.error = error instanceof Error ? error.message : String(error);
    }
    results.push(row);
    process.stdout.write(`${row.scenario_id} #${attempt}: ${row.execution_status}, deterministic ${row.deterministic?.status ?? "uncertain"}\n`);
  }
  const report = { metadata, summary: summary(results), results };
  const output = resolve(opts.output ?? resolve(here, "results", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)));
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(resolve(output, "summary.md"), markdown(report));
  process.stdout.write(`Reports: ${output}\n`);
  if (results.some((r) => r.execution_status === "fail")) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
