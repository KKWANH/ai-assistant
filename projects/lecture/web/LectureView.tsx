/**
 * LectureView — the lecture-prep home: the semester's COURSES.
 *
 * This used to be the whole vertical on one page (every course, every week and
 * every per-week action inline), which left nowhere to put a week's own
 * conversations or its generated files. It's now the index of a three-level
 * structure: courses → CourseView (weeks) → WeekView (the work).
 */
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, LayoutGrid, BookText, MessageSquare, ChevronRight } from "lucide-react";
import * as api from "./api";
import { getWorkspace } from "@ariadne/web/src/lib/api";
import { ContextEditor } from "@ariadne/web/src/features/workspace/ContextEditor";
import { useCourseChatTotals } from "./weekChats";
import { useLectureParams, coursePath } from "./lectureRoute";

export function LectureView() {
  const { workspaceId } = useLectureParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

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
    mutationFn: (course: string) => api.scaffoldLectureFolder(workspaceId, course),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lecture", workspaceId] }),
  });

  const courses = data?.courses ?? [];
  const chatTotals = useCourseChatTotals(
    workspaceId,
    courses.map((c) => c.name),
  );

  // Inline name input — window.prompt doesn't work on phones.
  const [newCourse, setNewCourse] = useState<string | null>(null);
  const submitCourse = () => {
    const name = newCourse?.trim();
    if (!name) return;
    scaffold.mutate(name);
    setNewCourse(null);
  };

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
              onClick={() => setNewCourse("")}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-3"
            >
              <Plus className="h-3.5 w-3.5" /> 과목 추가
            </button>
          </div>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          과목을 누르면 주차별로 준비할 수 있어요.
        </p>

        {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}

        {data && courses.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="mb-3 text-sm text-muted-foreground">아직 과목이 없습니다.</p>
            <button
              onClick={() => setNewCourse("")}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground"
            >
              <Plus className="h-4 w-4" /> 첫 과목 추가
            </button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {courses.map((c) => (
            <button
              key={c.path}
              onClick={() => navigate(coursePath(ws?.name ?? "", c.name))}
              className="group rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-border-strong"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
                  <span className="truncate">{c.name}</span>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{c.weeks.length}주차</span>
                {(chatTotals[c.name] ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    대화 {chatTotals[c.name]}
                  </span>
                )}
                {c.memo.trim() && <span>메모 ●</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {newCourse !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setNewCourse(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold">새 과목</h3>
            <input
              autoFocus
              value={newCourse}
              onChange={(e) => setNewCourse(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCourse();
              }}
              placeholder="과목 이름 (예: 조형예술론)"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setNewCourse(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
              <button
                onClick={submitCourse}
                disabled={!newCourse.trim() || scaffold.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {contextOpen && <ContextEditor workspaceId={workspaceId} onClose={() => setContextOpen(false)} />}
    </div>
  );
}
