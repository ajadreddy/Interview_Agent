import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkReply, validateScenarios } from "./checks.mjs";
import { parseUiStream } from "./run.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

test("Two Sum dataset has valid shape and required coverage", async () => {
  const scenarios = JSON.parse(await readFile(`${here}/scenarios.json`, "utf8"));
  const questions = JSON.parse(await readFile(new URL("../../data/questions.demo.json", import.meta.url), "utf8"));
  assert.equal(Object.values(validateScenarios(scenarios, questions.find((q) => q.id === "two-sum"))).reduce((a, b) => a + b, 0), 40);
  assert.ok(scenarios.filter((s) => s.category === "memory").every((s) => s.conversation_history.length >= 3));
});

test("fixed-history checks catch premature transitions and missing tools", () => {
  const scenario = { expected_phase_behavior: "stay", required_tools: ["read_current_code"] };
  const result = checkReply(scenario, "[->coding]\nUse a hash map? Why?", []);
  assert.equal(result.status, "fail");
  assert.ok(result.findings.some((f) => f.name === "phase_behavior" && f.status === "fail"));
  assert.ok(result.findings.some((f) => f.name === "required_tool:read_current_code" && f.status === "fail"));
});

test("completion cannot ask a question on the same turn", () => {
  const result = checkReply({ expected_phase_behavior: "complete" }, "Any more questions?\n[segment-complete]", []);
  assert.ok(result.findings.some((f) => f.name === "no_question_with_completion" && f.status === "fail"));
});

test("UI stream parser captures text, tool calls, results, and errors", () => {
  const raw = [
    { type: "tool-input-start", toolCallId: "1", toolName: "read_current_code" },
    { type: "tool-output-available", toolCallId: "1", output: { code: "pass" } },
    { type: "text-delta", delta: "What does this return?" },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const parsed = parseUiStream(raw);
  assert.equal(parsed.reply, "What does this return?");
  assert.deepEqual(parsed.toolCalls, ["read_current_code"]);
  assert.equal(parsed.toolResults.length, 1);
  assert.deepEqual(parsed.errors, []);
});
