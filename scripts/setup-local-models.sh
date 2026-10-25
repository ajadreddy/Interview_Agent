#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if ! ollama show mock-coding-local >/dev/null 2>&1; then
  if ! ollama show qwen3:4b-instruct >/dev/null 2>&1; then
    ollama pull qwen3:4b-instruct
  fi
  ollama create mock-coding-local -f "$root/scripts/Modelfile"
fi

printf 'Local Ollama interviewer ready\n'
