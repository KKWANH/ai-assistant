/**
 * Friendly display names + one-line characteristics for AI models.
 *
 * Simple ("easy") mode shows these instead of raw model ids, so a
 * non-technical user can pick a model by what it is good at rather than by
 * an opaque identifier like "qwen3:8b".
 */

export interface ModelInfo {
  /** A readable name, e.g. "클로드 소네트". */
  label: string;
  /** One-line characteristic — what this model is good for. */
  trait: string;
}

const KNOWN: Record<string, ModelInfo> = {
  // Anthropic Claude
  "claude-opus-4-7": { label: "클로드 오푸스", trait: "가장 정교한 추론 — 복잡하고 어려운 작업에" },
  "claude-sonnet-4-6": { label: "클로드 소네트", trait: "품질과 속도가 균형 잡힌 범용 모델" },
  "claude-haiku-4-5": { label: "클로드 하이쿠", trait: "빠르고 가벼운 응답에" },
  // OpenAI
  "gpt-4o": { label: "GPT-4o", trait: "이미지까지 다루는 범용 모델" },
  "gpt-4o-mini": { label: "GPT-4o 미니", trait: "빠르고 저렴한 경량 모델" },
  "o3-mini": { label: "o3 미니", trait: "추론에 특화된 경량 모델" },
  // Google Gemini
  "gemini-3.5-flash": { label: "제미나이 플래시", trait: "빠른 범용 모델" },
  "gemini-3.1-flash-lite": { label: "제미나이 플래시 라이트", trait: "가장 빠르고 가벼운 모델" },
  // Moonshot / Kimi
  "kimi-k2.6": { label: "키미 K2", trait: "긴 문서를 다루는 데 강한 모델" },
  // Ollama (local)
  "qwen3:8b": { label: "큐원 3 (8B)", trait: "추론·분석에 강한 표준 로컬 모델" },
  "qwen3:4b": { label: "큐원 3 (4B)", trait: "조금 더 빠른 가벼운 로컬 모델" },
  "qwen3:0.6b": { label: "큐원 3 (0.6B)", trait: "가장 빠르지만 단순한 작업용" },
  // Mock
  mock: { label: "목업", trait: "API 키 없이 쓰는 테스트용" },
};

/** Derive a label + trait for a model not in the known table (e.g. a local
 *  Ollama model the user installed themselves). The size token in the name,
 *  if any, gives a rough speed/capability hint. */
function derive(id: string): ModelInfo {
  const sizeMatch = id.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (sizeMatch && sizeMatch[1]) {
    const n = parseFloat(sizeMatch[1]);
    const trait =
      n >= 30
        ? "큰 규모의 로컬 모델 — 더 똑똑하지만 느릴 수 있음"
        : n >= 7
          ? "표준 규모의 로컬 모델"
          : "작고 빠른 로컬 모델 — 단순한 작업에";
    return { label: id, trait };
  }
  return { label: id, trait: "로컬에서 실행되는 AI 모델" };
}

/** Friendly display info for a model id. Never throws. */
export function modelInfo(id: string): ModelInfo {
  return KNOWN[id] ?? derive(id);
}
