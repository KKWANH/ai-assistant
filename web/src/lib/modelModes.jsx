import React from "react";
import { getCookie } from "./api.js";

export const DEFAULT_MODEL = "qwen3:8b";

export const MODEL_MODES = [
  {
    value: "local-small",
    group: "local",
    label: "Qwen3 4B Local",
    legacyLabel: "Local only",
    short: "Qwen3 4B",
    provider: "ollama",
    model: "qwen3:4b",
    cloud: false,
    inputPrice: 0,
    outputPrice: 0,
    cost: "Free · local Mac",
    easyPrice: "Free · local Mac",
    privacy: "Local Mac",
    bestFor: "Short questions, notes, everyday chat",
    recommendedUse: "Local/private text",
    supportsText: true,
    supportsImage: false,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "qwen3:4b · Ollama local",
  },
  {
    value: "local",
    group: "local",
    label: "Qwen3 8B Local",
    short: "Qwen3 8B",
    provider: "ollama",
    model: "qwen3:8b",
    cloud: false,
    inputPrice: 0,
    outputPrice: 0,
    cost: "Free · local Mac",
    easyPrice: "Free · stronger local model",
    privacy: "Local Mac",
    bestFor: "Higher local reasoning for a 24GB Mac mini · pull with Ollama if missing",
    recommendedUse: "Stronger private text",
    supportsText: true,
    supportsImage: false,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "qwen3:8b · Ollama local",
  },
  {
    value: "cheap",
    group: "fast",
    label: "Gemini 2.5 Flash-Lite",
    legacyLabel: "Cheap cloud",
    short: "Gemini 2.5 Flash-Lite",
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    cloud: true,
    inputPrice: 0.10,
    outputPrice: 0.40,
    agentCalls: 2,
    cost: "~$0.10/M in · ~$0.40/M out",
    easyPrice: "Very cheap · fast cloud",
    privacy: "Cloud AI",
    bestFor: "General questions, fast summaries, low-cost work",
    recommendedUse: "Cheap image analysis",
    supportsText: true,
    supportsImage: true,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "gemini-2.5-flash-lite",
  },
  {
    value: "gemini-pro",
    group: "reasoning",
    label: "Gemini 2.5 Pro",
    short: "Gemini 2.5 Pro",
    provider: "gemini",
    model: "gemini-2.5-pro",
    cloud: true,
    inputPrice: 1.25,
    outputPrice: 10.0,
    agentCalls: 3,
    cost: "~$1.25/M in · ~$10/M out",
    easyPrice: "Higher accuracy · paid",
    privacy: "Cloud AI",
    bestFor: "Complex questions, long writing, accuracy-sensitive work",
    recommendedUse: "Large context and reasoning",
    supportsText: true,
    supportsImage: true,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "gemini-2.5-pro",
  },
  {
    value: "smart",
    group: "long",
    label: "Kimi K2.6",
    legacyLabel: "Smart cloud",
    short: "Kimi K2.6",
    provider: "kimi",
    model: "kimi-k2.6",
    cloud: true,
    inputPrice: 0.95,
    outputPrice: 4.00,
    agentCalls: 3,
    cost: "~$0.95/M in · ~$4.00/M out",
    easyPrice: "Long context · paid",
    privacy: "Cloud AI",
    bestFor: "Long documents, long context, analysis",
    recommendedUse: "Long context",
    supportsText: true,
    supportsImage: true,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "kimi-k2.6",
  },
  {
    value: "kimi-thinking",
    group: "reasoning",
    label: "Kimi Thinking",
    legacyLabel: "Kimi thinking",
    short: "Kimi Thinking",
    provider: "kimi",
    model: "kimi-k2-thinking",
    cloud: true,
    inputPrice: 0.60,
    outputPrice: 2.50,
    agentCalls: 4,
    cost: "~$0.60/M in · ~$2.50/M out",
    easyPrice: "Deep reasoning · slower",
    privacy: "Cloud AI",
    bestFor: "Deep reasoning, long analysis",
    recommendedUse: "Deep reasoning",
    supportsText: true,
    supportsImage: true,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "kimi-k2-thinking",
  },
  {
    value: "coding",
    group: "coding",
    label: "OpenAI GPT-5.1 Codex",
    legacyLabel: "Coding expensive",
    short: "GPT-5.1 Codex",
    provider: "openai",
    model: "gpt-5.1-codex",
    cloud: true,
    inputPrice: 1.25,
    outputPrice: 10.0,
    agentCalls: 4,
    cost: "~$1.25/M in · ~$10/M out",
    easyPrice: "Coding specialist · paid",
    privacy: "Cloud AI",
    bestFor: "Code changes, refactoring, development work",
    recommendedUse: "Codex/code task",
    supportsText: true,
    supportsImage: false,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "gpt-5.1-codex",
  },
  {
    value: "ernie",
    group: "cloud",
    label: "ERNIE 5.1",
    short: "ERNIE 5.1",
    provider: "ernie",
    model: "ernie-5.1",
    cloud: true,
    inputPrice: 0,
    outputPrice: 0,
    cost: "Baidu Qianfan API · check console pricing",
    easyPrice: "Qianfan cloud · verify pricing",
    privacy: "Cloud AI",
    bestFor: "Chinese/multilingual work, long context, research analysis",
    recommendedUse: "Multilingual text",
    supportsText: true,
    supportsImage: false,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "ernie-5.1 · Baidu Qianfan API",
  },
];

export const SEARCH_OPTIONS = [
  { value: "off", label: "Search off" },
  { value: "auto", label: "Local context first", legacyLabel: "Local context only" },
  { value: "always", label: "Web search" },
];

export const ATTACHMENT_ACCEPT = ".txt,.md,.csv,.xls,.xlsx,.json,.yaml,.yml,.pdf,.docx,.ppt,.pptx,image/png,image/jpeg,image/gif,image/webp";

export function savedModelMode() {
  const value = decodeURIComponent(getCookie("aiws_model_mode") || "local");
  return MODEL_MODES.some((item) => item.value === value) ? value : "local";
}

export function savedSearchMode() {
  const value = decodeURIComponent(getCookie("aiws_search_mode") || "auto");
  return SEARCH_OPTIONS.some((item) => item.value === value) ? value : "auto";
}

export function fileNeedsVisionModel(file, mode, models = MODEL_MODES) {
  return Boolean(file?.type?.startsWith("image/") && !["kimi", "gemini"].includes(modelMode(mode, models).provider));
}

export function estimateCurrentCost(mode, content, hasFile, calls = 1) {
  if (!mode.cloud) return "$0";
  if (!(mode.inputPrice > 0) && !(mode.outputPrice > 0)) return "Verify pricing";
  const inputTokens = Math.max(120, Math.ceil(String(content || "").length / 3) + (hasFile ? 3000 : 0));
  const outputTokens = 1024;
  const estimated = ((inputTokens / 1_000_000) * mode.inputPrice + (outputTokens / 1_000_000) * mode.outputPrice) * calls;
  return `~$${estimated.toFixed(5)}`;
}

export function ModePrice({ mode, field = false, power = false }) {
  return (
    <div className={`mode-detail mode-price ${field ? "field-like" : ""}`}>
      <strong>{mode.label}</strong>
      <span>{mode.provider} · {mode.model}</span>
      <small>{mode.cost}</small>
      {power && <small>{mode.privacy} · {mode.bestFor}</small>}
    </div>
  );
}

export function modelLabel(model, models = MODEL_MODES) {
  return normalizeModelCatalog(models).find((item) => item.model === model)?.label || model;
}

export function modelMode(value, models = MODEL_MODES) {
  const normalized = normalizeModelCatalog(models);
  return normalized.find((item) => item.value === value) || normalized.find((item) => item.value === "local") || normalized[0] || MODEL_MODES[0];
}

export function normalizeModelCatalog(models = []) {
  if (!Array.isArray(models) || models.length === 0) return MODEL_MODES;
  return models.map((item) => ({
    value: item.value,
    group: item.group || (item.privacy === "local" ? "local" : "cloud"),
    label: item.label || item.model,
    legacyLabel: item.legacyLabel || item.legacy_label || "",
    short: item.short || item.model,
    provider: item.provider,
    model: item.model,
    cloud: Boolean(item.cloud ?? item.privacy === "cloud"),
    inputPrice: Number(item.inputPrice ?? item.input_per_million ?? 0),
    outputPrice: Number(item.outputPrice ?? item.output_per_million ?? 0),
    agentCalls: Number(item.agentCalls || 0),
    cost: item.cost || item.note || "",
    easyPrice: item.easyPrice || item.cost || "",
    privacy: item.privacy === "local" ? "Local Mac" : item.privacy || (item.cloud ? "Cloud AI" : "Local Mac"),
    bestFor: item.bestFor || item.recommendedUse || item.recommended_use || "",
    recommendedUse: item.recommendedUse || item.recommended_use || "",
    supportsText: Boolean(item.supportsText ?? item.supports_text ?? true),
    supportsImage: Boolean(item.supportsImage ?? item.supports_image),
    supportsFileText: Boolean(item.supportsFileText ?? item.supports_file_text ?? true),
    supportsWebSearch: Boolean(item.supportsWebSearch ?? item.supports_web_search),
    version: item.version || item.model,
    api_key_configured: Boolean(item.api_key_configured),
  })).filter((item) => item.value && item.provider && item.model);
}
