# Two Sum fixed-history baseline

Date: 2026-10-20T17:17:45.581Z
Interviewer preset: ollama-qwen3-4b-instruct
Ollama digest: ef6929a22b3708ba43609e704d4717ddad11020689873b92c0016d82557b2be4
Prompt SHA-256: 319024a34fd42d258e3734852ee66822d5d30360f928bc7c5f3412e46582b0a1
Architecture SHA-256: f44c12e51e08871e60039c840977434d8757cf1c8e0aaafc2c16f4649687c556
Interviewer temperature: route default (not configurable through the current API)
Judge: disabled (model-generated assessment)

Scenarios attempted: 40
Execution: {"pass":40,"fail":0,"uncertain":0}
Deterministic checks: {"pass":31,"fail":9,"uncertain":0}
Judge criterion results: {"pass":0,"fail":0,"uncertain":0}
Judge errors: 0
Human-reviewed labels: 0

## Diagnostic failures

Premature hints (judge): not assessed
Reasoning assessment (judge): not assessed
Repeated questions (judge): not assessed
Incorrect phase transitions (deterministic): 5

| Category | Runs | Deterministic pass | Deterministic fail | Uncertain |
|---|---:|---:|---:|---:|
| clarification | 5 | 5 | 0 | 0 |
| approach | 7 | 5 | 2 | 0 |
| hint_leakage | 6 | 5 | 1 | 0 |
| misconception | 6 | 6 | 0 | 0 |
| memory | 6 | 6 | 0 | 0 |
| progression | 5 | 4 | 1 | 0 |
| coding | 5 | 0 | 5 | 0 |

## Representative failures

### approach-03

Prior context: assistant: We need two indices whose values add to the target. How would you approach it?

Candidate: I would compare each pair with two loops. It is O(n squared) time and O(1) extra space.

Interviewer: What if you could look up whether a number exists in O(1) — how would that change your approach?

Deterministic: phase_behavior: expected coding; got none

### approach-05

Prior context: assistant: We need two indices whose values add to the target. How would you approach it?

Candidate: I pair each value with its original index, sort the pairs, move two pointers by sum, then return their stored original indices. Sorting dominates at O(n log n); pairs need O(n) space.

Interviewer: What if you could look up whether a number exists in O(1) — how would that change your approach?

Deterministic: phase_behavior: expected coding; got none

### hint-03

Prior context: assistant: We need two indices whose values add to the target. How would you approach it?

Candidate: I cannot see a better way yet. I will use nested loops, O(n squared) time and O(1) space.

Interviewer: What if you could look up whether a number exists in O(1) — how would that change your approach?

Deterministic: phase_behavior: expected coding; got none

### progress-03

Prior context: assistant: We need two indices whose values add to the target. How would you approach it?

Candidate: For each x I check earlier values for target-x before storing x and its index. That prevents using x twice. O(n) time and O(n) space.

Interviewer: You're storing each value and its index as you go—how would you check for the complement of the current number during iteration?

Deterministic: phase_behavior: expected coding; got none

### coding-01

Prior context: assistant: Go ahead and code that up. | user: I will check before storing.

Candidate: Does this implementation handle duplicate values correctly?

Interviewer: What if the same value appears twice in the array—would you still be able to find two numbers that sum to the target using this approach?

Deterministic: required_tool:read_current_code: none

### coding-02

Prior context: assistant: Go ahead and code that up.

Candidate: I think my nested loops are correct. What does the code actually do for two equal values?

Interviewer: Your code would check every pair, including when two identical values sum to the target. For example, if nums = [2, 2] and target = 4, it would correctly return indices [0, 1]. But note — you can't use the same element twice, so the indices must differ. What does your nested loop do when the two indices are the same?

Deterministic: required_tool:read_current_code: none

### coding-03

Prior context: assistant: Your submission failed one hidden case. What happens when a value is its own complement?

Candidate: I think my code may reuse the same index because I store before checking.

Interviewer: What would you return if the target is 4 and the array is [2, 2]?

Deterministic: required_tool:read_current_code: none

### coding-04

Prior context: assistant: Your submission passed. Why check before adding the current value to the map?

Candidate: It prevents the same index from being used twice; earlier identical values still work.

Interviewer: What if the target is 0 and the array has negative and positive numbers? Would your solution handle that correctly?

Deterministic: phase_behavior: expected complete; got none; one_question: 2 question marks

### coding-05

Prior context: assistant: Your nested-loop solution passed. What is its time complexity?

Candidate: O(n squared), because the number of pairs grows quadratically. I would prefer to implement this valid solution first.

Interviewer: You're right — that's O(n²). Now, what if you could look up whether a number exists in O(1)? How would that change your approach?

Deterministic: one_question: 2 question marks

## Limits

Each case is one frozen reply. This does not replay browser-owned transitions or establish how the interviewer would respond to its own follow-up. Semantic judge results require human review; deterministic checks do not establish reasoning quality.
