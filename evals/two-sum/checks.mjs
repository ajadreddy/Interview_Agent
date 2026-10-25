import assert from "node:assert/strict";

export const CATEGORY_COUNTS = {
  clarification: 5,
  approach: 7,
  hint_leakage: 6,
  misconception: 6,
  memory: 6,
  progression: 5,
  coding: 5,
};

const PHASES = new Set(["clarifying", "planning", "coding", "followUp"]);
const TRANSITIONS = ["[->planning]", "[->coding]", "[segment-complete]"];
const TOOLS = new Set([
  "read_current_code",
  "read_recent_transcript",
  "get_test_results",
  "run_tests",
]);

export function validateScenarios(scenarios, question) {
  assert.ok(Array.isArray(scenarios), "Dataset must be an array");
  assert.equal(scenarios.length, 40, "Expected exactly 40 scenarios");
  const counts = Object.fromEntries(Object.keys(CATEGORY_COUNTS).map((k) => [k, 0]));
  const ids = new Set();
  for (const s of scenarios) {
    assert.ok(typeof s.scenario_id === "string" && s.scenario_id, "Missing scenario_id");
    assert.ok(!ids.has(s.scenario_id), `Duplicate scenario_id ${s.scenario_id}`);
    ids.add(s.scenario_id);
    assert.ok(s.category in counts, `${s.scenario_id}: invalid category`);
    counts[s.category] += 1;
    assert.equal(s.problem_id, question.id, `${s.scenario_id}: wrong problem`);
    assert.ok(PHASES.has(s.initial_phase), `${s.scenario_id}: invalid phase`);
    assert.ok(Array.isArray(s.conversation_history), `${s.scenario_id}: history missing`);
    for (const m of s.conversation_history) {
      assert.ok(["user", "assistant"].includes(m.role) && typeof m.content === "string", `${s.scenario_id}: invalid history message`);
    }
    assert.ok(typeof s.candidate_message === "string" && s.candidate_message, `${s.scenario_id}: candidate message missing`);
    assert.ok(s.interview_state && typeof s.interview_state === "object", `${s.scenario_id}: state missing`);
    assert.ok(Array.isArray(s.expected_behaviors) && s.expected_behaviors.length, `${s.scenario_id}: expected behaviors missing`);
    assert.ok(Array.isArray(s.forbidden_behaviors), `${s.scenario_id}: forbidden behaviors missing`);
    assert.ok(typeof s.evaluation_rationale === "string" && s.evaluation_rationale, `${s.scenario_id}: rationale missing`);
    assert.ok(["stay", "planning", "coding", "complete", "any"].includes(s.expected_phase_behavior), `${s.scenario_id}: invalid phase expectation`);
    if (s.code_snapshot !== null) assert.equal(typeof s.code_snapshot, "string", `${s.scenario_id}: invalid code snapshot`);
    if (s.test_results !== null) {
      assert.equal(typeof s.test_results.visiblePassed, "boolean", `${s.scenario_id}: invalid test results`);
      assert.equal(typeof s.test_results.hiddenPassed, "boolean", `${s.scenario_id}: invalid test results`);
      assert.ok(Array.isArray(s.test_results.cases), `${s.scenario_id}: test cases missing`);
      for (const c of s.test_results.cases) {
        assert.equal(c.hidden, false, `${s.scenario_id}: hidden case details must not enter state`);
      }
    }
    for (const t of [...(s.required_tools ?? []), ...(s.forbidden_tools ?? [])]) {
      assert.ok(TOOLS.has(t), `${s.scenario_id}: unknown tool ${t}`);
    }
    const allowedState = new Set(["editorLocked", "forcedWrap", "followUpSegment", "activeFollowUp", "submitReviewHint", "codingEscalationHint", "finalFollowUpHint", "topicsProbed", "transcript", "testRunsUsed", "followUpTurnsUsed"]);
    for (const field of Object.keys(s.interview_state)) {
      assert.ok(allowedState.has(field), `${s.scenario_id}: unsupported state field ${field}`);
    }
  }
  assert.deepEqual(counts, CATEGORY_COUNTS, "Category counts differ from the dataset contract");
  return counts;
}

export function checkReply(scenario, reply, toolCalls, events = []) {
  const findings = [];
  const add = (name, pass, detail) => findings.push({ name, status: pass ? "pass" : "fail", detail });
  const tokens = [...reply.matchAll(/\[->planning\]|\[->coding\]|\[segment-complete\]/g)].map((m) => m[0]);
  add("known_transition_tokens", !/\[->[^\]]+\]/.test(reply.replaceAll("[->planning]", "").replaceAll("[->coding]", "")), tokens.join(", ") || "none");
  add("single_transition", tokens.length <= 1, tokens.join(", ") || "none");
  const allowed = {
    stay: [], planning: ["[->planning]"], coding: ["[->coding]"], complete: ["[segment-complete]"], any: TRANSITIONS,
  }[scenario.expected_phase_behavior];
  add("phase_behavior", scenario.expected_phase_behavior === "any" || (tokens.length === allowed.length && tokens.every((t) => allowed.includes(t))), `expected ${scenario.expected_phase_behavior}; got ${tokens.join(", ") || "none"}`);
  const visible = TRANSITIONS.reduce((text, token) => text.replaceAll(token, ""), reply);
  add("internal_note_leak", !/\[Interview control note|controlToken|\[Submit grade|\[HINT\s*[—-]/i.test(visible), "checked candidate-visible text");
  add("one_question", (visible.match(/\?/g) ?? []).length <= 1, `${(visible.match(/\?/g) ?? []).length} question marks`);
  add("no_question_with_completion", !tokens.includes("[segment-complete]") || !visible.includes("?"), "a completion turn must not leave a question unanswered");
  add("valid_tools", toolCalls.every((tool) => TOOLS.has(tool)), toolCalls.join(", ") || "none");
  for (const tool of scenario.required_tools ?? []) {
    add(`required_tool:${tool}`, toolCalls.includes(tool), toolCalls.join(", ") || "none");
    const firstText = events.findIndex((e) => e.type === "text-delta" && e.delta?.trim());
    const firstTool = events.findIndex((e) => e.type === "tool-input-start" && e.toolName === tool);
    if (firstText >= 0 && firstTool >= 0) add(`tool_before_reply:${tool}`, firstTool < firstText, `tool event ${firstTool}, first text ${firstText}`);
  }
  for (const tool of scenario.forbidden_tools ?? []) add(`forbidden_tool:${tool}`, !toolCalls.includes(tool), toolCalls.join(", ") || "none");
  return { status: findings.some((f) => f.status === "fail") ? "fail" : "pass", findings };
}
