/**
 * ExamPreview — a fullscreen preview of a generated exam + its coverage audit.
 * Items render as cards (type / difficulty / concept tags, choices, and the
 * answer behind a toggle); the coverage map shows the difficulty mix, which
 * concepts the exam tests vs misses, and any "미설명 개념" warnings the strong-
 * tier audit raised. A download button serves the real .docx (questions +
 * answer key + coverage appendix). Mirrors DeckPreview's shell.
 */
import { useState } from "react";
import { X, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Exam, CoverageReport, ExamDifficulty } from "../types.js";
import { deckFileUrl } from "./api";

const DIFF_ORDER: ExamDifficulty[] = ["기초", "심화", "응용"];
const DIFF_BAR: Record<ExamDifficulty, string> = {
  "기초": "bg-emerald-500",
  "심화": "bg-amber-500",
  "응용": "bg-rose-500",
};
const DIFF_CHIP: Record<ExamDifficulty, string> = {
  "기초": "bg-emerald-500/15 text-emerald-600",
  "심화": "bg-amber-500/15 text-amber-600",
  "응용": "bg-rose-500/15 text-rose-600",
};
const CHOICE_MARKS = ["①", "②", "③", "④", "⑤", "⑥"];

export function ExamPreview({
  workspaceId,
  exam,
  coverage,
  fileName,
  onClose,
}: {
  workspaceId: string;
  exam: Exam;
  coverage: CoverageReport;
  fileName: string;
  onClose: () => void;
}) {
  const [showAnswers, setShowAnswers] = useState(false);
  const total = exam.items.length || 1;
  const mix = DIFF_ORDER.map((d) => ({ d, n: exam.items.filter((it) => it.difficulty === d).length }));
  const untested = coverage.concepts.filter((c) => !c.tested);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 p-3 text-white">
          <span className="min-w-0 truncate text-sm font-medium">
            {exam.title} · {exam.items.length}문항
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setShowAnswers((s) => !s)}
              className="rounded-md bg-white/10 px-2.5 py-1.5 text-sm text-white hover:bg-white/20"
            >
              {showAnswers ? "정답 숨기기" : "정답 보기"}
            </button>
            <a
              href={deckFileUrl(workspaceId, fileName)}
              className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-sm text-white hover:bg-white/20"
            >
              <Download className="h-4 w-4" /> .docx
            </a>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="닫기"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto rounded-t-xl bg-card p-4 sm:p-6">
          {/* Coverage map */}
          <div className="mb-5 rounded-xl border border-border bg-surface-2 p-4">
            <h3 className="mb-2 text-sm font-semibold">출제 커버리지</h3>
            {coverage.summary && <p className="mb-3 text-sm text-muted-foreground">{coverage.summary}</p>}

            <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-card">
              {mix.map(({ d, n }) =>
                n > 0 ? (
                  <div key={d} className={DIFF_BAR[d]} style={{ width: `${(n / total) * 100}%` }} title={`${d} ${n}`} />
                ) : null,
              )}
            </div>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              {mix.map(({ d, n }) => (
                <span key={d} className={`rounded px-1.5 py-0.5 ${DIFF_CHIP[d]}`}>
                  {d} {n}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {coverage.concepts.map((c, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs ${
                    c.tested ? "bg-card text-muted-foreground" : "bg-rose-500/10 text-rose-600"
                  }`}
                  title={c.tested ? `${c.itemCount}문항` : "미출제"}
                >
                  {c.tested ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {c.concept}
                  {c.tested ? ` (${c.itemCount})` : ""}
                </span>
              ))}
            </div>
            {untested.length > 0 && (
              <p className="mt-2 text-xs text-rose-600">미출제 개념 {untested.length}개 — 보강을 고려하세요.</p>
            )}

            {coverage.untaught.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" /> 미설명 개념 출제 경고
                </p>
                <ul className="space-y-0.5 text-2xs text-muted-foreground">
                  {coverage.untaught.map((u, i) => (
                    <li key={i}>
                      • {u.question} — {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="space-y-3">
            {exam.items.map((it, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold">{i + 1}.</span>
                  <span className="rounded bg-card px-1.5 py-0.5 text-2xs text-muted-foreground">{it.type}</span>
                  <span className={`rounded px-1.5 py-0.5 text-2xs ${DIFF_CHIP[it.difficulty]}`}>{it.difficulty}</span>
                  {it.concept && (
                    <span className="rounded bg-card px-1.5 py-0.5 text-2xs text-muted-foreground/70">{it.concept}</span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm">{it.question}</p>
                {it.choices && it.choices.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {it.choices.map((c, j) => (
                      <li key={j}>
                        {CHOICE_MARKS[j] ?? "·"} {c}
                      </li>
                    ))}
                  </ul>
                )}
                {showAnswers && (
                  <div className="mt-2 rounded-lg bg-emerald-500/5 p-2 text-sm">
                    <span className="font-medium text-emerald-600">정답 </span>
                    <span className="whitespace-pre-wrap text-foreground">{it.answer}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
