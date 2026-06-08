/**
 * LectureView — the lecture-prep "custom project UI": a semester workspace
 * shown as course cards → weeks → materials, with controls to add a course
 * or week (scaffolds folders) and to open a week's chat. Reads the live
 * folder structure from GET /api/workspaces/:id/lecture.
 */
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, FileText, Plus, MessageSquarePlus } from "lucide-react";
import * as api from "../../lib/api";
import { useCreateChat } from "../../lib/queries";

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
                <button
                  onClick={() => addWeek(c.name)}
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> 주차
                </button>
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
                    <button
                      onClick={() => openWeekChat(c.name, w.name)}
                      className="inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" /> 자료 만들기
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
