import React, { useEffect, useRef, useState } from "react";
import { copyForLocale } from "../../shared/copy/copy";

const MODEL_GROUPS = [
  { value: "recommended", label: "Recommended", match: (model, recommendations) => recommendations?.some((entry) => model.value === entry.model.value) },
  { value: "local", label: "Local", match: (model) => !model.cloud },
  { value: "cheap", label: "Cheap", match: (model) => !model.cloud || Number(model.inputPrice || 0) <= 0.3 },
  { value: "long", label: "Long context", match: (model) => /kimi|pro/i.test(`${model.provider} ${model.model} ${model.group}`) },
  { value: "reasoning", label: "Reasoning", match: (model) => /pro|thinking|reasoning/i.test(`${model.model} ${model.group}`) },
  { value: "code", label: "Code", match: (model) => /codex|code|coding/i.test(`${model.model} ${model.group}`) },
  { value: "vision", label: "Vision", match: (model) => Boolean(model.supportsImage) },
  { value: "all", label: "All", match: () => true },
];

export function ModelPickerButton({ open, setOpen, selectedKey, onSelect, content, hasFile, power, modelCatalog = [] }) {
  const models = Array.isArray(modelCatalog) ? modelCatalog : [];
  const mode = models.find((item) => item.value === selectedKey) || models.find((item) => item.value === "local") || models[0] || {};
  const [group, setGroup] = useState("recommended");
  const wrapRef = useRef(null);
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  const recommendations = recommendModels(models, { content, hasFile }).slice(0, 4);
  const groupDef = MODEL_GROUPS.find((entry) => entry.value === group) || MODEL_GROUPS[0];
  const visibleModels = models.filter((item) => groupDef.match(item, recommendations));

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen]);

  return (
    <div className="model-picker-wrap" ref={wrapRef}>
      <button className="model-select-button" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <strong>{mode.label}</strong>
        <span>{compactModelCost(mode)}</span>
      </button>
      {open && (
        <div className="model-picker" role="dialog" aria-label="AI model picker">
          <header>
            <div>
              <strong>{copy.modelPicker.title}</strong>
              <small>{mode.label} {copy.modelPicker.selected}</small>
            </div>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </header>
          <div className="model-quick-row">
            {MODEL_GROUPS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={group === item.value ? "active" : ""}
                onClick={() => setGroup(item.value)}
              >
                {copy.modelPicker.groups[item.value] || item.label}
              </button>
            ))}
          </div>
          <div className="model-recommendation">
            <strong>추천 모델 {Math.min(recommendations.length, 4)}개</strong>
            <small>작업 종류별 추천. 실제 비용은 provider billing 기준, 여기는 토큰 단가 기반 예측.</small>
          </div>
          <div className="model-grid">
            {visibleModels.map((item) => {
              const selected = item.value === selectedKey;
              const recommended = recommendations.some((entry) => item.value === entry.model.value);
              const singleEstimate = estimateCurrentCost(item, content, hasFile);
              const agentCalls = item.agentCalls || (item.cloud ? 2 : 1);
              const agentEstimate = estimateCurrentCost(item, content, hasFile, agentCalls);
              const keyMissing = Boolean(item.cloud && !item.api_key_configured);
              const keyStatus = item.cloud ? (keyMissing ? "API key missing" : "API key connected") : "Local";
              const disabledReason = keyMissing ? "Add this provider API key in .env before selecting." : "";
              return (
                <button
                  key={item.value}
                  type="button"
                  className={`model-card ${selected ? "selected" : ""} ${recommended ? "recommended" : ""} ${item.cloud ? "cloud" : "local"} ${keyMissing ? "disabled" : ""}`}
                  disabled={keyMissing}
                  title={disabledReason || item.bestFor || item.recommendedUse}
                  onClick={() => {
                    if (keyMissing) return;
                    onSelect(item.value);
                    setOpen(false);
                  }}
                >
                  <span className="model-card-title">{item.label}</span>
                  {recommended && <span className="model-key-status">{recommendations.find((entry) => item.value === entry.model.value)?.label || "Recommended"}</span>}
                  <span className="model-card-version">{item.version || item.model}</span>
                  <span className="model-card-privacy">{item.cloud ? "Cloud AI" : "Local Mac"}</span>
                  <span>{item.recommendedUse || item.bestFor}</span>
                  <span className="model-card-capabilities">
                    {item.supportsText && "Text"}
                    {item.supportsImage ? " · Image" : " · No image"}
                    {item.supportsFileText && " · File text"}
                    {item.supportsWebSearch ? " · Web" : " · No web"}
                  </span>
                  <span className="model-card-price">{power && item.cloud && item.inputPrice > 0 ? `Input ~$${item.inputPrice.toFixed(2)} / 1M · output ~$${item.outputPrice.toFixed(2)} / 1M` : item.easyPrice || item.cost}</span>
                  <span className="model-card-estimate">Single call estimate: {singleEstimate}</span>
                  {item.cloud && <span className="model-card-estimate">Agent {agentCalls}-step budget: {agentEstimate}</span>}
                  {item.cloud && <span className="model-card-estimate">Actual cost accumulates per executed model call</span>}
                  <span className={`model-key-status ${keyMissing ? "missing" : ""}`}>{keyStatus}</span>
                  {disabledReason && <span className="model-card-estimate">{disabledReason}</span>}
                  {power && <code>{item.provider} · {item.model}</code>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function compactModelCost(mode) {
  if (!mode.cloud) return "Free · local Mac";
  return mode.easyPrice || "Paid";
}

function estimateCurrentCost(mode, content, hasFile, calls = 1) {
  if (!mode.cloud) return "$0";
  if (!(mode.inputPrice > 0) && !(mode.outputPrice > 0)) return "Verify pricing";
  const inputTokens = Math.max(120, Math.ceil(String(content || "").length / 3) + (hasFile ? 3000 : 0));
  const outputTokens = 1024;
  const estimated = ((inputTokens / 1_000_000) * mode.inputPrice + (outputTokens / 1_000_000) * mode.outputPrice) * calls;
  return `~$${estimated.toFixed(5)}`;
}

function recommendModels(models, { content = "", hasFile = false } = {}) {
  const local8b = models.find((item) => item.provider === "ollama" && /8b/i.test(item.model || item.label || ""));
  const local = local8b || models.find((item) => !item.cloud) || models[0] || {};
  const localSmall = models.find((item) => !item.cloud && item.value !== local.value);
  const flash = models.find((item) => item.provider === "gemini" && item.model.includes("flash"));
  const pro = models.find((item) => item.provider === "gemini" && item.model.includes("pro"));
  const kimi = models.find((item) => item.provider === "kimi");
  const codex = models.find((item) => item.provider === "openai" || item.group === "coding");
  const text = String(content || "").toLowerCase();
  const picks = [
    { model: local, label: "기본 로컬", reason: "Private local work. No API cost." },
  ];
  if (hasFile) {
    picks.push({ model: flash || local, label: "파일/이미지", reason: "Low-cost file or vision work when cloud is allowed." });
  }
  if (/(code|bug|test|refactor|codex|파일|코드|버그|테스트)/.test(text) && codex) {
    picks.push({ model: codex, label: "코드", reason: "Code-oriented model." });
  }
  if (content.length > 8000 && pro) {
    picks.push({ model: pro, label: "긴 문서", reason: "Long context cloud model." });
  }
  if (pro) picks.push({ model: pro, label: "고품질", reason: "Higher quality cloud answer." });
  if (kimi) picks.push({ model: kimi, label: "긴 컨텍스트", reason: "Long-context option." });
  if (localSmall) picks.push({ model: localSmall, label: "빠른 로컬", reason: "Small local fallback." });
  const seen = new Set();
  return picks.filter((item) => item.model?.value && !seen.has(item.model.value) && seen.add(item.model.value)).slice(0, 4);
}
