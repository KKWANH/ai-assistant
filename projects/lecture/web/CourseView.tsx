/**
 * CourseView — one course: its weeks, and the course memo that every generated
 * deliverable is grounded in. A week row shows what actually exists for it
 * (conversations / materials), so it's obvious where work is and isn't.
 */
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, FileText, MessageSquare, Paperclip } from "lucide-react";
import * as api from "./api";
import { useCourseChatCounts } from "./weekChats";

export function CourseView() {
  const { id: workspaceId = "", course: courseParam = "" } = useParams<{ id: string; course: string }>();
  const course = decodeURIComponent(courseParam);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["lecture", workspaceId],
    queryFn: () => api.getLectureStructure(workspaceId),
    enabled: !!workspaceId,
  });
  const c = data?.courses.find((x) => x.name === course);

  const scaffold = useMutation({
    mutationFn: (week: string) => api.scaffoldLectureFolder(workspaceId, course, week),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lecture", workspaceId] }),
  });
  const saveMemo = useMutation({
    mutationFn: (memo: string) => api.setCourseMemo(workspaceId, course, memo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lecture", workspaceId] });
      setMemoEdit(null);
    },
  });

  const chatCounts = useCourseChatCounts(workspaceId, course, (c?.weeks ?? []).map((w) => w.name));

  const [newWeek, setNewWeek] = useState<string | null>(null);
  const submitWeek = () => {
    const name = newWeek?.trim();
    if (!name) return;
    scaffold.mutate(name);
    setNewWeek(null);
  };
  const [memoEdit, setMemoEdit] = useState<string | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <Link
          to={`/workspaces/${workspaceId}/lecture`}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> 강의 준비
        </Link>

        <div className="mb-1 flex flex-wrap items-center justify-between gap-y-2">
          <h1 className="text-lg font-semibold">{course}</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMemoEdit(c?.memo ?? "")}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-surface-3 hover:text-foreground"
              title="이 과목의 줄기·교수 스타일·수강생 수준 — 생성물에 자동 반영"
            >
              <FileText className="h-3.5 w-3.5" /> 과목 메모{c?.memo.trim() ? " ●" : ""}
            </button>
            <button
              onClick={() => setNewWeek("")}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-3"
            >
              <Plus className="h-3.5 w-3.5" /> 주차 추가
            </button>
          </div>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {c?.weeks.length ?? 0}개 주차 · 주차를 누르면 그 주차의 대화와 자료가 모여 있어요.
        </p>

        {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
        {data && !c && <p className="text-sm text-muted-foreground">과목을 찾을 수 없습니다.</p>}

        {c && c.files.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
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

        {c && c.weeks.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="mb-3 text-sm text-muted-foreground">아직 주차가 없습니다.</p>
            <button
              onClick={() => setNewWeek("")}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground"
            >
              <Plus className="h-4 w-4" /> 첫 주차 추가
            </button>
          </div>
        )}

        <div className="space-y-1.5">
          {c?.weeks.map((w) => (
            <button
              key={w.path}
              onClick={() =>
                navigate(
                  `/workspaces/${workspaceId}/lecture/c/${encodeURIComponent(course)}/w/${encodeURIComponent(w.name)}`,
                )
              }
              className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-border-strong"
            >
              <span className="min-w-0 truncate text-sm font-medium">{w.name}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {(chatCounts[w.name] ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> {chatCounts[w.name]}
                  </span>
                )}
                {w.materials.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Paperclip className="h-3 w-3" /> {w.materials.length}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {newWeek !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setNewWeek(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold">주차 추가 · {course}</h3>
            <input
              autoFocus
              value={newWeek}
              onChange={(e) => setNewWeek(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitWeek();
              }}
              placeholder="주차 이름 (예: 03주차)"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setNewWeek(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
              <button
                onClick={submitWeek}
                disabled={!newWeek.trim() || scaffold.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {memoEdit !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setMemoEdit(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-semibold">{course} · 과목 메모</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              이 과목의 줄기·교수 스타일·수강생 수준을 적어두면, 이 과목 생성물에 자동 반영됩니다.
            </p>
            <textarea
              value={memoEdit}
              onChange={(e) => setMemoEdit(e.target.value)}
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
    </div>
  );
}
