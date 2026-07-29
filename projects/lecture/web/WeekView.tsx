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
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  MessageSquare,
  MessageSquarePlus,
  Presentation,
  ClipboardList,
  FileStack,
  FileText,
  Loader2,
} from "lucide-react";
import type { Deck, Exam, CoverageReport, DocType, GeneratedDoc } from "../types.js";
import * as api from "./api";
import { useCreateChat, useWorkspaces } from "@ariadne/web/src/lib/queries";
import { DeckPreview } from "./DeckPreview";
import { ExamPreview } from "./ExamPreview";
import { DocPreview } from "./DocPreview";
import { useWeekChats, weekScope, weekTitle } from "./weekChats";

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

/** Section wrapper — keeps the three blocks visually parallel. */
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function WeekView() {
  const {
    id: workspaceId = "",
    course: courseParam = "",
    week: weekParam = "",
  } = useParams<{ id: string; course: string; week: string }>();
  const course = decodeURIComponent(courseParam);
  const week = decodeURIComponent(weekParam);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createChat = useCreateChat();

  const { data } = useQuery({
    queryKey: ["lecture", workspaceId],
    queryFn: () => api.getLectureStructure(workspaceId),
    enabled: !!workspaceId,
  });
  const c = data?.courses.find((x) => x.name === course);
  const w = c?.weeks.find((x) => x.name === week);

  // The week's existing conversations — the whole point of this page.
  const chats = useWeekChats(workspaceId, course, week);

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
    ? "슬라이드 생성 중… (자료를 근거로 덱을 만들고 있어요 · 1–2분)"
    : genExam.isPending
      ? "시험 생성 중… (문항 생성 + 커버리지 점검 · 1–2분)"
      : "산출물 생성 중… (자료를 근거로 문서를 만드는 중 · 1분)";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link
          to={`/workspaces/${workspaceId}/lecture/c/${encodeURIComponent(course)}`}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> {course}
        </Link>

        <h1 className="text-lg font-semibold">{week}</h1>
        <p className="mb-5 text-sm text-muted-foreground">{course}</p>

        {/* 대화 — existing threads first, so work is resumed, not restarted. */}
        <Section
          title="대화"
          action={
            <button
              onClick={startChat}
              disabled={createChat.isPending}
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" /> 새 대화
            </button>
          }
        >
          {chats.length === 0 ? (
            <button
              onClick={startChat}
              className="w-full rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground hover:border-border-strong hover:text-foreground"
            >
              이 주차의 첫 대화를 시작하세요 — 자료를 올리고 강의안·스크립트를 만들 수 있어요.
            </button>
          ) : (
            <div className="space-y-1.5">
              {chats.map((chat) => (
                <Link
                  key={chat.id}
                  to={`/chat/${chat.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 hover:border-border-strong"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{chat.title}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {chat.updatedAt.slice(0, 10)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* 자료 — what's filed under this week. */}
        <Section title="자료">
          {!w || w.materials.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              아직 자료가 없습니다. 대화에 파일을 첨부하거나, 이 주차 폴더에 넣어두면 여기에 표시됩니다.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {w.materials.map((m) => (
                <span
                  key={m.path}
                  className="inline-flex items-center gap-1 rounded bg-card px-2 py-1 text-2xs text-muted-foreground"
                >
                  <FileText className="h-3 w-3" /> {m.name}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* 만들기 — the generators, grounded in this week. */}
        <Section title="만들기">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                setPullSources([]);
                setSlidePrompt("");
              }}
              className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card px-3 py-3 text-xs hover:border-border-strong"
            >
              <Presentation className="h-4 w-4 text-accent" /> 슬라이드
            </button>
            <button
              onClick={() => {
                setPullSources([]);
                setExamPrompt(8);
              }}
              className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card px-3 py-3 text-xs hover:border-border-strong"
            >
              <ClipboardList className="h-4 w-4 text-accent" /> 시험
            </button>
            <button
              onClick={() => {
                setPullSources([]);
                setDocPrompt(true);
              }}
              className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card px-3 py-3 text-xs hover:border-border-strong"
            >
              <FileStack className="h-4 w-4 text-accent" /> 산출물
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
            <h3 className="mb-1 text-sm font-semibold">산출물 만들기</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {course} · {week} — 이 주차 자료를 근거로 생성할 산출물을 고르세요.
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
