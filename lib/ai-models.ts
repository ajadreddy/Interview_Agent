export type AiProvider = "ollama" | "gemini" | "groq" | "anthropic" | "openai";

export type AiModelConfig = {
  provider: AiProvider;
  model: string;
};

export const AI_MODEL_PRESETS = {
  "ollama-qwen3-4b-instruct": {
    provider: "ollama" as const,
    model: "mock-coding-local",
  },
  "openai-gpt-5.4-mini": {
    provider: "openai" as const,
    model: "gpt-5.4-mini",
  },
  "groq-llama-3.3-70b": {
    provider: "groq" as const,
    model: "llama-3.3-70b-versatile",
  },
  "gemini-2.5-flash": {
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
  },
  "anthropic-claude-sonnet-4-6": {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-6",
  },
} as const satisfies Record<string, AiModelConfig>;

export type AiModelPresetId = keyof typeof AI_MODEL_PRESETS;

export const AI_MODEL_OPTIONS: ReadonlyArray<{
  id: AiModelPresetId;
  label: string;
}> = [
  { id: "ollama-qwen3-4b-instruct", label: "Local Ollama" },
  { id: "openai-gpt-5.4-mini", label: "OpenAI GPT-5.4 Mini" },
  { id: "groq-llama-3.3-70b", label: "Groq Llama 3.3 70B" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "anthropic-claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];

// The installed Ollama model runs the interview and feedback without a key.
export const DEFAULT_AI_MODEL_PRESET_ID: AiModelPresetId = "ollama-qwen3-4b-instruct";

/** localStorage key for the interview model picker (survives refresh). */
export const AI_MODEL_PRESET_STORAGE_KEY = "mock-coding:modelPresetId:v3";

export function isAiModelPresetId(id: string): id is AiModelPresetId {
  return id in AI_MODEL_PRESETS;
}

export function getAiModelConfig(id: string): AiModelConfig | null {
  if (!isAiModelPresetId(id)) {
    return null;
  }
  const config = AI_MODEL_PRESETS[id];
  if (config.provider === "ollama" && process.env.OLLAMA_MODEL) {
    return { ...config, model: process.env.OLLAMA_MODEL };
  }
  return config;
}
