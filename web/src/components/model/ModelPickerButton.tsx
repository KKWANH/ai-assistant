import React, { useEffect, useRef, useState } from "react";
import { copyForLocale } from "../../shared/copy/copy";
import styles from "./ModelPickerButton.module.css";

export type PickerModel = {
  value?: string;
  group?: string;
  label?: string;
  version?: string;
  provider?: string;
  model?: string;
  cloud?: boolean;
  inputPrice?: number;
  outputPrice?: number;
  easyPrice?: string;
  cost?: string;
  privacy?: string;
  bestFor?: string;
  recommendedUse?: string;
  supportsText?: boolean;
  supportsImage?: boolean;
  supportsFileText?: boolean;
  supportsWebSearch?: boolean;
  api_key_configured?: boolean;
  agentCalls?: number;
};

type Recommendation = {
  model: PickerModel;
  label: string;
  reason: string;
};

type ModelGroup = {
  value: string;
  label: string;
  match: (model: PickerModel, recommendations: Recommendation[]) => boolean;
};

type ModelPickerButtonProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  selectedKey?: string;
  onSelect: (value: string) => void;
  content?: string;
  hasFile?: boolean;
  power?: boolean;
  modelCatalog?: PickerModel[];
};

const MODEL_GROUPS: ModelGroup[] = [
  { value: "recommended", label: "Recommended", match: (model, recommendations) => recommendations?.some((entry) => model.value === entry.model.value) },
  { value: "local", label: "Local", match: (model) => !model.cloud },
  { value: "cloud", label: "Cloud", match: (model) => Boolean(model.cloud) },
  { value: "cheap", label: "Cheap", match: (model) => !model.cloud || Number(model.inputPrice || 0) <= 0.3 },
  { value: "long", label: "Long context", match: (model) => /kimi|pro/i.test(`${model.provider} ${model.model} ${model.group}`) },
  { value: "reasoning", label: "Reasoning", match: (model) => /pro|thinking|reasoning/i.test(`${model.model} ${model.group}`) },
  { value: "code", label: "Code", match: (model) => /codex|code|coding/i.test(`${model.model} ${model.group}`) },
  { value: "vision", label: "Vision", match: (model) => Boolean(model.supportsImage) },
  { value: "all", label: "All", match: () => true },
];

export function ModelPickerButton({ open, setOpen, selectedKey, onSelect, content = "", hasFile = false, power = false, modelCatalog = [] }: ModelPickerButtonProps) {
  const models = Array.isArray(modelCatalog) ? modelCatalog : [];
  const mode = models.find((item) => item.value === selectedKey) || models.find((item) => item.value === "local") || models[0] || {};
  const [group, setGroup] = useState("recommended");
  const [showDetails, setShowDetails] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  const easy = !power;
  const compactEasy = easy && !showDetails;
  const groups = easy ? MODEL_GROUPS.filter((item) => ["recommended", "local", "cloud"].includes(item.value)) : MODEL_GROUPS;
  const recommendations = recommendModels(models, { content, hasFile }, copy).slice(0, 4);
  const safeGroup = groups.some((item) => item.value === group) ? group : "recommended";
  const groupDef = groups.find((entry) => entry.value === safeGroup) || groups[0];
  const visibleModels = compactEasy
    ? recommendations.map((entry) => entry.model)
    : models.filter((item) => groupDef.match(item, recommendations));

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: PointerEvent) {
      if (wrapRef.current && event.target instanceof Node && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button className={styles.selectButton} type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <strong>{mode.label || "Model"}</strong>
        <span>{compactModelCost(mode)}</span>
      </button>
      {open && (
        <div className={`${styles.picker} ${easy ? styles.easy : styles.power}`} role="dialog" aria-label="AI model picker">
          <header>
            <div>
              <strong>{easy ? copy.modelPicker.easyTitle || copy.modelPicker.title : copy.modelPicker.title}</strong>
              <small>{easy ? copy.modelPicker.easyHint : `${mode.label} ${copy.modelPicker.selected}`}</small>
            </div>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </header>
          {easy && (
            <button className={styles.detailsToggle} type="button" onClick={() => setShowDetails((value) => !value)}>
              {showDetails ? copy.modelPicker.hideDetails : copy.modelPicker.showDetails}
            </button>
          )}
          {!compactEasy && (
            <div className={styles.quickRow}>
              {groups.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={safeGroup === item.value ? styles.active : ""}
                  onClick={() => setGroup(item.value)}
                >
                  {modelPickerGroupLabel(copy, item.value) || item.label}
                </button>
              ))}
            </div>
          )}
          {compactEasy && (
            <div className={`${styles.recommendation} ${styles.simple}`}>
              <strong>추천 모델</strong>
              <small>작업별 4개만 표시함. 상세 설정을 열면 전체 모델과 가격 정보를 볼 수 있음.</small>
            </div>
          )}
          {!compactEasy && (
            <div className={styles.recommendation}>
              <strong>{copy.modelPicker.recommendationTitle || `추천 모델 ${Math.min(recommendations.length, 4)}개`}</strong>
              <small>{copy.modelPicker.recommendationHint || "작업 종류별 추천. 실제 비용은 provider billing 기준, 여기는 토큰 단가 기반 예측."}</small>
            </div>
          )}
          <div className={styles.grid}>
            {visibleModels.map((item) => {
              const selected = item.value === selectedKey;
              const recommended = recommendations.some((entry) => item.value === entry.model.value);
              const recommendation = recommendations.find((entry) => item.value === entry.model.value);
              const singleEstimate = estimateCurrentCost(item, content, hasFile);
              const agentCalls = item.agentCalls || (item.cloud ? 2 : 1);
              const agentEstimate = estimateCurrentCost(item, content, hasFile, agentCalls);
              const keyMissing = Boolean(item.cloud && !item.api_key_configured);
              const keyStatus = item.cloud ? (keyMissing ? copy.modelPicker.keyMissing : copy.modelPicker.keyReady) : copy.modelPicker.local;
              const disabledReason = keyMissing ? copy.modelPicker.keyMissingHint : "";
              return (
                <button
                  key={item.value || item.model || item.label}
                  type="button"
                  className={[
                    styles.card,
                    selected ? styles.selected : "",
                    recommended ? styles.recommended : "",
                    item.cloud ? styles.cloud : styles.local,
                    keyMissing ? styles.disabled : "",
                  ].join(" ")}
                  disabled={keyMissing}
                  title={disabledReason || item.bestFor || item.recommendedUse}
                  onClick={() => {
                    if (keyMissing || !item.value) return;
                    onSelect(item.value);
                    setOpen(false);
                  }}
                >
                  <span className={styles.cardTitle}>{item.label || item.model}</span>
                  {recommended && <span className={styles.keyStatus}>{recommendation?.label || modelPickerGroupLabel(copy, "recommended")}</span>}
                  {!compactEasy && <span className={styles.cardVersion}>{item.version || item.model}</span>}
                  <span className={styles.cardPrivacy}>{item.cloud ? copy.modelPicker.cloudAi : copy.modelPicker.localMac}</span>
                  <span>{compactEasy ? easyModelReason(item, recommendation, copy) : item.recommendedUse || item.bestFor || easyModelReason(item, recommendation, copy)}</span>
                  {!compactEasy && (
                    <span className={styles.cardCapabilities}>
                      {item.supportsText && "Text"}
                      {item.supportsImage ? " · Image" : " · No image"}
                      {item.supportsFileText && " · File text"}
                      {item.supportsWebSearch ? " · Web" : " · No web"}
                    </span>
                  )}
                  <span className={styles.cardPrice}>{power && item.cloud && Number(item.inputPrice || 0) > 0 ? `Input ~$${Number(item.inputPrice || 0).toFixed(2)} / 1M · output ~$${Number(item.outputPrice || 0).toFixed(2)} / 1M` : item.easyPrice || item.cost || easyModelCostLabel(item, copy)}</span>
                  {compactEasy && item.cloud && <span className={`${styles.cardEstimate} ${styles.easyCloud}`}>예상 {singleEstimate}</span>}
                  {!compactEasy && <span className={styles.cardEstimate}>Single call estimate: {singleEstimate}</span>}
                  {!compactEasy && item.cloud && <span className={styles.cardEstimate}>Agent {agentCalls}-step budget: {agentEstimate}</span>}
                  {!compactEasy && item.cloud && <span className={styles.cardEstimate}>Actual cost accumulates per executed model call</span>}
                  {(!compactEasy || keyMissing) && <span className={`${styles.keyStatus} ${keyMissing ? styles.missing : ""}`}>{keyStatus}</span>}
                  {disabledReason && <span className={styles.cardEstimate}>{disabledReason}</span>}
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

function modelPickerGroupLabel(copy: ReturnType<typeof copyForLocale>, value: string): string {
  return String((copy.modelPicker.groups as Record<string, string>)[value] || "");
}

function easyModelReason(item: PickerModel, recommendation: Recommendation | undefined, copy: ReturnType<typeof copyForLocale>): string {
  if (recommendation?.label) return recommendation.label;
  if (!item.cloud) return copy.modelPicker.easyLocalReason || "Private local work";
  if (item.supportsImage) return copy.modelPicker.easyVisionReason || "Files and images";
  return copy.modelPicker.easyCloudReason || "Stronger cloud answer";
}

function compactModelCost(mode: PickerModel): string {
  if (!mode.cloud) return "Free · local";
  return mode.easyPrice || "Paid";
}

function estimateCurrentCost(mode: PickerModel, content = "", hasFile = false, calls = 1): string {
  if (!mode.cloud) return "$0";
  if (!(Number(mode.inputPrice || 0) > 0) && !(Number(mode.outputPrice || 0) > 0)) return "Verify pricing";
  const inputTokens = Math.max(120, Math.ceil(String(content || "").length / 3) + (hasFile ? 3000 : 0));
  const outputTokens = 1024;
  const estimated = ((inputTokens / 1_000_000) * Number(mode.inputPrice || 0) + (outputTokens / 1_000_000) * Number(mode.outputPrice || 0)) * calls;
  return `~$${estimated.toFixed(5)}`;
}

function easyModelCostLabel(item: PickerModel, copy: ReturnType<typeof copyForLocale>): string {
  return item.cloud ? copy.modelPicker.paidCloud : copy.modelPicker.freeLocal;
}

function recommendModels(
  models: PickerModel[],
  { content = "", hasFile = false }: { content?: string; hasFile?: boolean } = {},
  copy: ReturnType<typeof copyForLocale>,
): Recommendation[] {
  const local8b = models.find((item) => item.provider === "ollama" && /8b/i.test(item.model || item.label || ""));
  const local = local8b || models.find((item) => !item.cloud) || models[0] || {};
  const localSmall = models.find((item) => !item.cloud && item.value !== local.value);
  const flash = models.find((item) => item.provider === "gemini" && String(item.model || "").includes("flash"));
  const pro = models.find((item) => item.provider === "gemini" && String(item.model || "").includes("pro"));
  const kimi = models.find((item) => item.provider === "kimi");
  const codex = models.find((item) => item.provider === "openai" || item.group === "coding");
  const text = String(content || "").toLowerCase();
  const picks: Recommendation[] = [
    { model: local, label: copy.modelPicker.recLocal, reason: "Private local work. No API cost." },
  ];
  if (hasFile) {
    picks.push({ model: flash || local, label: copy.modelPicker.recFile, reason: "Low-cost file or vision work when cloud is allowed." });
  }
  if (/(code|bug|test|refactor|codex|파일|코드|버그|테스트)/.test(text) && codex) {
    picks.push({ model: codex, label: copy.modelPicker.recCode, reason: "Code-oriented model." });
  }
  if (content.length > 8000 && pro) {
    picks.push({ model: pro, label: copy.modelPicker.recLong, reason: "Long context cloud model." });
  }
  if (pro) picks.push({ model: pro, label: copy.modelPicker.recQuality, reason: "Higher quality cloud answer." });
  if (kimi) picks.push({ model: kimi, label: copy.modelPicker.recLong, reason: "Long-context option." });
  if (localSmall) picks.push({ model: localSmall, label: copy.modelPicker.recFastLocal, reason: "Small local fallback." });
  const seen = new Set();
  return picks.filter((item) => item.model?.value && !seen.has(item.model.value) && seen.add(item.model.value)).slice(0, 4);
}
