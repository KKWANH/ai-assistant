/**
 * LectureView — the lecture-prep "custom project UI": a semester workspace
 * shown as course cards → weeks → materials, with controls to add a course
 * or week (scaffolds folders) and to open a week's chat. Reads the live
 * folder structure from GET /api/workspaces/:id/lecture.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, FileText, Plus, MessageSquarePlus, Presentation, Loader2 } from "lucide-react";
import type { Deck } from "@ariadne/shared";
import * as api from "../../lib/api";
import { useCreateChat } from "../../lib/queries";
import { DeckPreview } from "./DeckPreview";

export function LectureView() {
  const { id: workspaceId = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createChat = useCreateChat();

  const { data: ws } = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => api.getWorkspace(workspaceId),
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

  const addCourse = () => {
    const name = window.prompt("새 과목 이름 (예: 조형예술론)")?.trim();
    if (name) scaffold.mutate({ course: name });
  };
  const addWeek = (course: string) => {
    const name = window.prompt(`"${course}" 주차 이름 (예: 03주차)`)?.trim();
    if (name) scaffold.mutate({ course, week: name });
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

  const [memoEdit, setMemoEdit] = useState<{ course: string; memo: string } | null>(null);
  const saveMemo = useMutation({
    mutationFn: (v: { course: string; memo: string }) => api.setCourseMemo(workspaceId, v.course, v.memo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lecture", workspaceId] });
      setMemoEdit(null);
    },
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold">강의 준비</h1>
          <button
            onClick={addCourse}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-3"
          >
            <Plus className="h-3.5 w-3.5" /> 과목 추가
          </button>
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
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
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
                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        onClick={() => makeSlides(c.name, w.name)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Presentation className="h-3.5 w-3.5" /> 슬라이드
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

      {deckResult && (
        <DeckPreview
          workspaceId={workspaceId}
          deck={deckResult.deck}
          fileName={deckResult.fileName}
          course={deckResult.course}
          onClose={() => setDeckResult(null)}
        />
      )}
    </div>
  );
}
