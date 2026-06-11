/**
 * LectureView — the lecture-prep "custom project UI": a semester workspace
 * shown as course cards → weeks → materials, with controls to add a course
 * or week (scaffolds folders) and to open a week's chat. Reads the live
 * folder structure from GET /api/workspaces/:id/lecture.
 */
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, FileText, Plus, MessageSquarePlus, Presentation, Loader2, LayoutGrid, BookText, ClipboardList } from "lucide-react";
import type { Deck, Exam, CoverageReport } from "../types.js";
import * as api from "./api";
import { getWorkspace } from "@ariadne/web/src/lib/api";
import { useCreateChat } from "@ariadne/web/src/lib/queries";
import { DeckPreview } from "./DeckPreview";
import { ExamPreview } from "./ExamPreview";
import { ContextEditor } from "@ariadne/web/src/features/workspace/ContextEditor";

export function LectureView() {
  const { id: workspaceId = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createChat = useCreateChat();

  const { data: ws } = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: !!workspaceId,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["lecture", workspaceId],
    queryFn: () => api.getLectureStructure(workspaceId),
    enabled: !!workspaceId,
  });
  const scaffold = useMutation({
    mutationFn: (v: { course: string; week?: string }) =>
      api.scaffoldLectureFolder(workspaceId, v.course, v.week),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lecture", workspaceId] }),
  });

  // Inline name input — works on mobile (window.prompt does not on phones).
  const [namePrompt, setNamePrompt] = useState<
    { mode: "course"; value: string } | { mode: "week"; course: string; value: string } | null
  >(null);
  const addCourse = () => setNamePrompt({ mode: "course", value: "" });
  const addWeek = (course: string) => setNamePrompt({ mode: "week", course, value: "" });
  const submitName = () => {
    const name = namePrompt?.value.trim();
    if (!namePrompt || !name) return;
    if (namePrompt.mode === "course") scaffold.mutate({ course: name });
    else scaffold.mutate({ course: namePrompt.course, week: name });
    setNamePrompt(null);
  };
  const openWeekChat = (course: string, week: string) => {
    createChat.mutate(
      { workspaceId, title: `${course} · ${week}` },
      { onSuccess: (chat) => navigate(`/chat/${chat.id}`) },
    );
  };

  const [deckResult, setDeckResult] = useState<{ deck: Deck; fileName: string; course: string } | null>(null);
  const genDeck = useMutation({
    mutationFn: (v: { topic: string; course: string; week: string }) =>
      api.generateDeck(workspaceId, v.topic, v.course, v.week),
    onSuccess: (r, v) => setDeckResult({ ...r, course: v.course }),
  });
  const [slidePrompt, setSlidePrompt] = useState<{ course: string; week: string; topic: string } | null>(null);
  const makeSlides = (course: string, week: string) => setSlidePrompt({ course, week, topic: "" });
  const submitSlides = () => {
    const topic = slidePrompt?.topic.trim();
    if (slidePrompt && topic) {
      genDeck.mutate({ topic, course: slidePrompt.course, week: slidePrompt.week });
      setSlidePrompt(null);
    }
  };

  const [examResult, setExamResult] = useState<{ exam: Exam; coverage: CoverageReport; fileName: string } | null>(
    null,
  );
  const genExam = useMutation({
    mutationFn: (v: { course: string; week: string; count: number }) =>
      api.generateExam(workspaceId, v.course, v.week, v.count),
    onSuccess: (r) => setExamResult(r),
  });
  const [examPrompt, setExamPrompt] = useState<{ course: string; week: string; count: number } | null>(null);
  const makeExam = (course: string, week: string) => setExamPrompt({ course, week, count: 8 });
  const submitExam = () => {
    if (examPrompt) {
      genExam.mutate(examPrompt);
      setExamPrompt(null);
    }
  };

  const [memoEdit, setMemoEdit] = useState<{ course: string; memo: string } | null>(null);
  const saveMemo = useMutation({
    mutationFn: (v: { course: string; memo: string }) => api.setCourseMemo(workspaceId, v.course, v.memo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lecture", workspaceId] });
      setMemoEdit(null);
    },
  });

  const [contextOpen, setContextOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-y-2">
          <h1 className="text-lg font-semibold">강의 준비</h1>
          <div className="flex items-center gap-1">
            <Link
              to={`/workspaces/${workspaceId}`}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-surface-3 hover:text-foreground"
              title="채팅·자료·파일 등 워크스페이스 전체 보기"
            >
              <LayoutGrid className="h-3.5 w-3.5" /> 개요
            </Link>
            <button
              onClick={() => setContextOpen(true)}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-surface-3 hover:text-foreground"
              title="이 학기 배경·강의 스타일·수강생 수준 — 모든 답변·생성물에 반영"
            >
              <BookText className="h-3.5 w-3.5" /> 지침
            </button>
            <button
              onClick={addCourse}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-3"
            >
              <Plus className="h-3.5 w-3.5" /> 과목 추가
            </button>
          </div>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {ws?.name ?? "한 학기"} · 과목별 주차 자료를 한 곳에서 관리합니다.
        </p>

        {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}

        {data && data.courses.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="mb-3 text-sm text-muted-foreground">아직 과목이 없습니다.</p>
            <button
              onClick={addCourse}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground"
            >
              <Plus className="h-4 w-4" /> 첫 과목 추가
            </button>
          </div>
        )}

        <div className="space-y-4">
          {data?.courses.map((c) => (
            <div key={c.path} className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">· {c.weeks.length}주차</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => setMemoEdit({ course: c.name, memo: c.memo })}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    title="과목 메모 — 줄기·교수 스타일·수강생 수준 (슬라이드에 자동 반영)"
                  >
                    <FileText className="h-3 w-3" /> 메모{c.memo.trim() ? " ●" : ""}
                  </button>
                  <button
                    onClick={() => addWeek(c.name)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" /> 주차
                  </button>
                </div>
              </div>

              {c.files.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.files.map((f) => (
                    <span
                      key={f.path}
                      className="inline-flex items-center gap-1 rounded bg-card px-1.5 py-0.5 text-2xs text-muted-foreground"
                    >
                      <FileText className="h-3 w-3" /> {f.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 space-y-1.5">
                {c.weeks.length === 0 && (
                  <p className="text-xs text-muted-foreground">주차를 추가하세요.</p>
                )}
                {c.weeks.map((w) => (
                  <div
                    key={w.path}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="shrink-0 font-medium">{w.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">자료 {w.materials.length}</span>
                      {w.materials.length > 0 && (
                        <span className="truncate text-2xs text-muted-foreground/70">
                          {w.materials.map((m) => m.name).join(", ")}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-4 sm:gap-3">
                      <button
                        onClick={() => makeSlides(c.name, w.name)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Presentation className="h-3.5 w-3.5" /> 슬라이드
                      </button>
                      <button
                        onClick={() => makeExam(c.name, w.name)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ClipboardList className="h-3.5 w-3.5" /> 시험
                      </button>
                      <button
                        onClick={() => openWeekChat(c.name, w.name)}
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" /> 자료 만들기
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {slidePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSlidePrompt(null)}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold">슬라이드 만들기</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {slidePrompt.course} · {slidePrompt.week} — 이 주차 자료를 근거로 덱을 생성합니다.
            </p>
            <input
              autoFocus
              value={slidePrompt.topic}
              onChange={(e) => setSlidePrompt({ ...slidePrompt, topic: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSlides();
              }}
              placeholder="슬라이드 주제 (예: 바로크 조각 — 베르니니)"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setSlidePrompt(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
              <button
                onClick={submitSlides}
                disabled={!slidePrompt.topic.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {examPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setExamPrompt(null)}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold">시험 만들기</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {examPrompt.course} · {examPrompt.week} — 이 주차 자료를 근거로 문항을 생성하고, 출제 커버리지를 점검합니다.
            </p>
            <label className="flex items-center gap-2 text-sm">
              문항 수
              <input
                type="number"
                min={3}
                max={20}
                value={examPrompt.count}
                onChange={(e) =>
                  setExamPrompt({ ...examPrompt, count: Math.max(3, Math.min(20, Number(e.target.value) || 8)) })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitExam();
                }}
                className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setExamPrompt(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
              <button onClick={submitExam} className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground">
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {namePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setNamePrompt(null)}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold">
              {namePrompt.mode === "course" ? "새 과목" : `주차 추가 · ${namePrompt.course}`}
            </h3>
            <input
              autoFocus
              value={namePrompt.value}
              onChange={(e) => setNamePrompt({ ...namePrompt, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
              }}
              placeholder={namePrompt.mode === "course" ? "과목 이름 (예: 조형예술론)" : "주차 이름 (예: 03주차)"}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setNamePrompt(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
              <button
                onClick={submitName}
                disabled={!namePrompt.value.trim() || scaffold.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {memoEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setMemoEdit(null)}
        >
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold">{memoEdit.course} · 과목 메모</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              이 과목의 줄기·교수 스타일·수강생 수준을 적어두면, 이 과목 슬라이드 생성에 자동 반영됩니다.
            </p>
            <textarea
              value={memoEdit.memo}
              onChange={(e) => setMemoEdit({ ...memoEdit, memo: e.target.value })}
              rows={8}
              placeholder="예: 학부 2학년 대상. 작품 분석 중심, 미술사 맥락을 곁들임. 어려운 용어는 쉽게 풀어 설명. 매 강의 도판 3–4점."
              className="w-full resize-y rounded-md border border-border bg-surface-2 p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setMemoEdit(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
              <button
                onClick={() => saveMemo.mutate(memoEdit)}
                disabled={saveMemo.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
              >
                {saveMemo.isPending ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {genDeck.isPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            슬라이드 생성 중… (자료를 근거로 덱을 만들고 있어요 · 1–2분)
          </div>
        </div>
      )}

      {genExam.isPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            시험 생성 중… (문항 생성 + 커버리지 점검 · 1–2분)
          </div>
        </div>
      )}

      {deckResult && (
        <DeckPreview
          workspaceId={workspaceId}
          deck={deckResult.deck}
          fileName={deckResult.fileName}
          course={deckResult.course}
          onClose={() => setDeckResult(null)}
        />
      )}

      {examResult && (
        <ExamPreview
          workspaceId={workspaceId}
          exam={examResult.exam}
          coverage={examResult.coverage}
          fileName={examResult.fileName}
          onClose={() => setExamResult(null)}
        />
      )}

      {contextOpen && <ContextEditor workspaceId={workspaceId} onClose={() => setContextOpen(false)} />}
    </div>
  );
}
