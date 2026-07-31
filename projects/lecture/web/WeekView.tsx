/**
 * WeekView — ONE week: its conversations, its materials, and the deliverables
 * generated for it. This is the page the vertical was missing.
 *
 * The important part is 대화: a week's existing chats are listed and reopened.
 * The old view's only chat control created a brand-new thread every time it was
 * pressed (titled `<course> · <week>`), so a week accumulated duplicates — three
 * for one week here, one of them empty — and there was no way back into the
 * conversation you were actually working in. Chats now carry a `scope` key, so
 * this page can find them.
 */
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  MessageSquare,
  MessageSquarePlus,
  Presentation,
  ClipboardList,
  FileStack,
  FileText,
  Paperclip,
  Loader2,
} from "lucide-react";
import type { Deck, Exam, CoverageReport, DocType, GeneratedDoc } from "../types.js";
import * as api from "./api";
import { useCreateChat, useWorkspaces } from "@ariadne/web/src/lib/queries";
import { DeckPreview } from "./DeckPreview";
import { ExamPreview } from "./ExamPreview";
import { DocPreview } from "./DocPreview";
import { useWeekChats, weekScope, weekTitle } from "./weekChats";
import { useLectureParams, resolveName, coursePath } from "./lectureRoute";
import { getWorkspace } from "@ariadne/web/src/lib/api";

/** The deliverables the "산출물" menu offers (MW3 fan-out). */
const DOC_TYPES: { type: DocType; label: string }[] = [
  { type: "handout", label: "유인물" },
  { type: "worksheet", label: "워크시트" },
  { type: "reading", label: "참고문헌" },
  { type: "syllabus", label: "강의계획" },
];

const toggleId = (arr: string[], id: string): string[] =>
  arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

/** Opt-in cross-workspace pull picker (MW5). Renders nothing when there are none. */
function PullSources({
  options,
  selected,
  onToggle,
}: {
  options: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground">
        다른 워크스페이스에서도 가져오기{selected.length > 0 ? ` (${selected.length})` : ""}
      </summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onToggle(o.id)}
            className={`rounded px-2 py-1 text-2xs ${
              selected.includes(o.id)
                ? "bg-accent text-accent-foreground"
                : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
            }`}
          >
            {o.name}
          </button>
        ))}
      </div>
    </details>
  );
}

/** Section wrapper — keeps the blocks visually parallel. `hint` says, in plain
 *  words, what the block is for: this page is used by a lecturer who doesn't
 *  want to guess what a heading means. */
function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

export function WeekView() {
  const { workspaceId, courseSegment, weekSegment } = useLectureParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createChat = useCreateChat();

  const { data: ws } = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: !!workspaceId,
  });
  const { data } = useQuery({
    queryKey: ["lecture", workspaceId],
    queryFn: () => api.getLectureStructure(workspaceId),
    enabled: !!workspaceId,
  });
  // URL segments are slugs ("0주차-강의설계"); the real names carry spaces.
  const course = resolveName(courseSegment, (data?.courses ?? []).map((x) => x.name)) ?? "";
  const c = data?.courses.find((x) => x.name === course);
  const week = resolveName(weekSegment, (c?.weeks ?? []).map((x) => x.name)) ?? "";
  const w = c?.weeks.find((x) => x.name === week);

  // The week's existing conversations — the whole point of this page.
  const chats = useWeekChats(workspaceId, course, week);

  // Files attached inside those conversations. Without this, 자료 stayed empty
  // for a week that had several PDFs uploaded — they were in the chat, not the
  // folder, and only the folder was ever scanned.
  const { data: attachmentData } = useQuery({
    queryKey: ["lecture", workspaceId, "week-attachments", course, week],
    queryFn: () => api.getWeekAttachments(workspaceId, course, week),
    enabled: !!workspaceId && !!course && !!week,
  });
  const chatFiles = attachmentData?.attachments ?? [];

  const startChat = () =>
    createChat.mutate(
      { workspaceId, title: weekTitle(course, week), scope: weekScope(course, week) },
      { onSuccess: (chat) => navigate(`/chat/${chat.id}`) },
    );

  // Cross-workspace grounding, shared by the three generators.
  const { data: allWorkspaces } = useWorkspaces();
  const otherWorkspaces = (allWorkspaces ?? [])
    .filter((x) => x.id !== workspaceId)
    .map((x) => ({ id: x.id, name: x.name }));
  const [pullSources, setPullSources] = useState<string[]>([]);
  const togglePull = (id: string) => setPullSources((s) => toggleId(s, id));

  const afterGenerate = () => void qc.invalidateQueries({ queryKey: ["lecture", workspaceId] });

  const [deckResult, setDeckResult] = useState<{ deck: Deck; fileName: string } | null>(null);
  const genDeck = useMutation({
    mutationFn: (v: { topic: string; sources: string[] }) =>
      api.generateDeck(workspaceId, v.topic, course, week, v.sources),
    onSuccess: (r) => {
      setDeckResult(r);
      afterGenerate();
    },
  });
  const [slidePrompt, setSlidePrompt] = useState<string | null>(null);

  const [examResult, setExamResult] = useState<
    { exam: Exam; coverage: CoverageReport; fileName: string } | null
  >(null);
  const genExam = useMutation({
    mutationFn: (v: { count: number; sources: string[] }) =>
      api.generateExam(workspaceId, course, week, v.count, v.sources),
    onSuccess: (r) => {
      setExamResult(r);
      afterGenerate();
    },
  });
  const [examPrompt, setExamPrompt] = useState<number | null>(null);

  const [docResult, setDocResult] = useState<
    { doc: GeneratedDoc; fileName: string; type: DocType; label: string } | null
  >(null);
  const genDoc = useMutation({
    mutationFn: (v: { type: DocType; sources: string[] }) =>
      api.generateDoc(workspaceId, v.type, course, week, v.sources),
    onSuccess: (r, v) => {
      setDocResult({ ...r, type: v.type, label: DOC_TYPES.find((d) => d.type === v.type)?.label ?? "" });
      afterGenerate();
    },
  });
  const [docPrompt, setDocPrompt] = useState(false);

  const busy = genDeck.isPending || genExam.isPending || genDoc.isPending;
  const busyLabel = genDeck.isPending
    ? "슬라이드 만드는 중… (1–2분쯤 걸려요)"
    : genExam.isPending
      ? "시험 만드는 중… (문제를 만들고 빠진 개념을 점검해요 · 1–2분)"
      : "수업 자료 만드는 중… (1분쯤 걸려요)";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link
          to={coursePath(ws?.name ?? "", course)}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> {course}
        </Link>

        <h1 className="text-lg font-semibold">{week}</h1>
        <p className="mb-5 text-sm text-muted-foreground">{course}</p>

        {/* 대화 — existing threads first, so work is resumed, not restarted. */}
        <Section
          title="대화"
          hint={
            chats.length > 0
              ? "이어서 하려면 아래 대화를 누르세요. 새로 시작할 때만 ‘새 대화’를 누르시면 됩니다."
              : "AI와 이야기하며 강의안과 학생용 설명을 만드는 곳이에요."
          }
          action={
            <button
              onClick={startChat}
              disabled={createChat.isPending}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-3 disabled:opacity-50"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" /> 새 대화
            </button>
          }
        >
          {chats.length === 0 ? (
            <button
              onClick={startChat}
              className="w-full rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground hover:border-border-strong hover:text-foreground"
            >
              이 주차의 첫 대화를 시작하세요
              <span className="mt-1 block text-xs">
                파일(PDF·PPT)을 올리고 “학생용 설명 만들어줘”처럼 말하면 됩니다.
              </span>
            </button>
          ) : (
            <div className="space-y-2">
              {chats.map((chat) => (
                <Link
                  key={chat.id}
                  to={`/chat/${chat.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:border-border-strong"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{chat.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {/* Several chats on one week share a title and a date, so the
                        row needs something that actually distinguishes them —
                        and an abandoned empty one should say so rather than
                        looking like the others. */}
                    {chat.messageCount === 0 ? (
                      <span className="rounded bg-surface-3 px-1.5 py-0.5">비어 있음</span>
                    ) : chat.messageCount ? (
                      <span>{chat.messageCount}개 메시지</span>
                    ) : null}
                    <span>{chat.updatedAt.slice(0, 10)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* 자료 — what's filed under this week. */}
        <Section title="자료" hint="이 주차에 모인 파일이에요. 여기서 만든 파일도 이 자리에 쌓입니다.">
          {(w?.materials.length ?? 0) === 0 && chatFiles.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
              아직 자료가 없습니다. 대화에 파일을 첨부하시면 여기에 함께 보입니다.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {(w?.materials.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {w?.materials.map((m) => (
                    <span
                      key={m.path}
                      className="inline-flex items-center gap-1 rounded bg-card px-2 py-1 text-xs text-muted-foreground"
                    >
                      <FileText className="h-3.5 w-3.5" /> {m.name}
                    </span>
                  ))}
                </div>
              )}
              {chatFiles.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-2xs text-muted-foreground">대화에 올린 파일</span>
                  <div className="flex flex-wrap gap-1.5">
                    {chatFiles.map((f) => (
                      <a
                        key={f.id}
                        href={`/api/uploads/${f.id}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`${f.name} — 눌러서 열기`}
                        className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground"
                      >
                        <Paperclip className="h-3.5 w-3.5" /> {f.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* 만들기 — the generators, grounded in this week. Each button says what
            comes OUT of it: "슬라이드" alone doesn't tell you a .pptx appears. */}
        <Section title="만들기" hint="이 주차 자료를 근거로 AI가 초안을 만들어 드려요. 만든 파일은 위 ‘자료’에 저장됩니다.">
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              onClick={() => {
                setPullSources([]);
                setSlidePrompt("");
              }}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-4 hover:border-border-strong"
            >
              <Presentation className="h-5 w-5 text-accent" />
              <span className="text-sm font-medium">슬라이드</span>
              <span className="text-xs text-muted-foreground">PPT 초안 만들기</span>
            </button>
            <button
              onClick={() => {
                setPullSources([]);
                setExamPrompt(8);
              }}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-4 hover:border-border-strong"
            >
              <ClipboardList className="h-5 w-5 text-accent" />
              <span className="text-sm font-medium">시험</span>
              <span className="text-xs text-muted-foreground">문제 + 빠진 개념 점검</span>
            </button>
            <button
              onClick={() => {
                setPullSources([]);
                setDocPrompt(true);
              }}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-4 hover:border-border-strong"
            >
              <FileStack className="h-5 w-5 text-accent" />
              <span className="text-sm font-medium">수업 자료</span>
              <span className="text-xs text-muted-foreground">유인물·워크시트 등</span>
            </button>
          </div>
        </Section>
      </div>

      {slidePrompt !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSlidePrompt(null)}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold">슬라이드 만들기</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {course} · {week} — 이 주차 자료를 근거로 덱을 생성합니다.
            </p>
            <input
              autoFocus
              value={slidePrompt}
              onChange={(e) => setSlidePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && slidePrompt.trim()) {
                  genDeck.mutate({ topic: slidePrompt.trim(), sources: pullSources });
                  setSlidePrompt(null);
                }
              }}
              placeholder="슬라이드 주제 (예: 바로크 조각 — 베르니니)"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <PullSources options={otherWorkspaces} selected={pullSources} onToggle={togglePull} />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setSlidePrompt(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
              <button
                onClick={() => {
                  genDeck.mutate({ topic: slidePrompt.trim(), sources: pullSources });
                  setSlidePrompt(null);
                }}
                disabled={!slidePrompt.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {examPrompt !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setExamPrompt(null)}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold">시험 만들기</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {course} · {week} — 이 주차 자료를 근거로 문항을 생성하고, 출제 커버리지를 점검합니다.
            </p>
            <label className="flex items-center gap-2 text-sm">
              문항 수
              <input
                type="number"
                min={3}
                max={20}
                value={examPrompt}
                onChange={(e) => setExamPrompt(Math.max(3, Math.min(20, Number(e.target.value) || 8)))}
                className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <PullSources options={otherWorkspaces} selected={pullSources} onToggle={togglePull} />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setExamPrompt(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
              <button
                onClick={() => {
                  genExam.mutate({ count: examPrompt, sources: pullSources });
                  setExamPrompt(null);
                }}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground"
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {docPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setDocPrompt(false)}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold">수업 자료 만들기</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {course} · {week} — 어떤 자료를 만들까요?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DOC_TYPES.map((d) => (
                <button
                  key={d.type}
                  onClick={() => {
                    genDoc.mutate({ type: d.type, sources: pullSources });
                    setDocPrompt(false);
                  }}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm hover:bg-surface-3"
                >
                  {d.label}
                </button>
              ))}
            </div>
            <PullSources options={otherWorkspaces} selected={pullSources} onToggle={togglePull} />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => setDocPrompt(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            {busyLabel}
          </div>
        </div>
      )}

      {deckResult && (
        <DeckPreview
          workspaceId={workspaceId}
          deck={deckResult.deck}
          fileName={deckResult.fileName}
          course={course}
          week={week}
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

      {docResult && (
        <DocPreview
          workspaceId={workspaceId}
          type={docResult.type}
          doc={docResult.doc}
          fileName={docResult.fileName}
          label={docResult.label}
          onClose={() => setDocResult(null)}
        />
      )}
    </div>
  );
}
