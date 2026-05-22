/**
 * Visual building blocks for the /tutorial page — a mix of geometric SVG
 * art, lucide-icon diagrams, and inert UI mockups. Everything is theme-aware
 * (design tokens + currentColor) with no binary assets, so a single visual
 * works in light and dark and never goes stale. The one genuine live
 * component is EvidenceBadge, embedded in EvidenceDemo.
 */
import type { ReactNode } from "react";
import {
  Folder,
  Layers,
  MessageSquare,
  Bot,
  Sparkles,
  ArrowRight,
  Paperclip,
  Globe,
  Play,
  FileText,
  ListChecks,
  TrendingUp,
  Flag,
  Check,
} from "lucide-react";
import { useT } from "../../lib/i18n";
import { EvidenceBadge } from "../../components/ui/EvidenceBadge";

/** Inert frame around a UI mockup — clarifies it is an example, not live UI. */
export function DemoFrame({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="relative w-full max-w-md rounded-xl border border-border bg-surface-2 p-4">
      <span className="absolute right-2 top-2 z-10 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {t("tutorial.page.exampleBadge")}
      </span>
      <div className="pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/** One labelled node in a flow diagram. */
function Node({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-2 text-accent">
        {icon}
      </div>
      <span className="max-w-[5.5rem] text-[11px] leading-tight text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function Arrow() {
  return <ArrowRight className="h-4 w-4 shrink-0 text-border-strong" />;
}

// ── SVG illustrations ────────────────────────────────────────────────────────

/** Welcome — local files becoming source-backed work. */
export function WelcomeArt() {
  return (
    <svg viewBox="0 0 260 132" className="h-32 w-auto" fill="none" aria-hidden="true">
      {/* stacked source files */}
      <rect x="20" y="34" width="40" height="52" rx="5" className="stroke-border-strong" strokeWidth="2" />
      <rect x="34" y="46" width="40" height="52" rx="5" className="fill-surface-2 stroke-border-strong" strokeWidth="2" />
      <line x1="44" y1="60" x2="64" y2="60" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" />
      <line x1="44" y1="70" x2="64" y2="70" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" />
      <line x1="44" y1="80" x2="58" y2="80" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" />
      {/* flow */}
      <path d="M84 72 H112" className="stroke-accent" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 4" />
      {/* AI core — the web motif */}
      <g className="stroke-accent" strokeWidth="2" strokeLinecap="round">
        <path d="M130 50 130 94M130 72 152 60M130 72 152 84M130 72 108 60M130 72 108 84" />
        <path d="M130 50 152 60 152 84 130 94 108 84 108 60Z" />
      </g>
      <circle cx="130" cy="72" r="4" className="fill-accent" />
      <path d="M148 72 H176" className="stroke-accent" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 4" />
      {/* result document with check */}
      <rect x="186" y="40" width="48" height="58" rx="5" className="fill-surface-2 stroke-border-strong" strokeWidth="2" />
      <line x1="196" y1="56" x2="224" y2="56" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" />
      <line x1="196" y1="66" x2="224" y2="66" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" />
      <circle cx="210" cy="84" r="9" className="fill-accent" />
      <path d="M205.5 84 L209 87.5 L214.5 81.5" className="stroke-accent-foreground" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Ready — a celebratory check. */
export function ReadyArt() {
  return (
    <svg viewBox="0 0 140 132" className="h-32 w-auto" fill="none" aria-hidden="true">
      <g className="stroke-accent" strokeWidth="2.4" strokeLinecap="round">
        <path d="M70 14 V30M70 102 V118M14 66 H30M110 66 H126M30 26 L41 37M110 26 L99 37M30 106 L41 95M110 106 L99 95" />
      </g>
      <circle cx="70" cy="66" r="30" className="fill-accent" />
      <path d="M56 66 L66 76 L86 54" className="stroke-accent-foreground" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Diagrams ─────────────────────────────────────────────────────────────────

/** Workspace — a local folder becomes something the AI can use. */
export function WorkspaceDiagram() {
  const { t } = useT();
  return (
    <div className="flex w-full max-w-md items-start justify-center gap-3 py-6">
      <Node icon={<Folder className="h-6 w-6" />} label={t("tutorial.page.workspaces.nodeFolder")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<Layers className="h-6 w-6" />} label={t("tutorial.page.workspaces.nodeWorkspace")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<MessageSquare className="h-6 w-6" />} label={t("tutorial.page.workspaces.nodeChat")} />
    </div>
  );
}

/** Actions — read a file, ask AI, run the pipeline. */
export function ActionsScenarioDiagram() {
  const { t } = useT();
  return (
    <div className="flex w-full max-w-md items-start justify-center gap-2 py-6">
      <Node icon={<FileText className="h-6 w-6" />} label={t("tutorial.page.actions.nodeRead")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<Sparkles className="h-6 w-6" />} label={t("tutorial.page.actions.nodeAsk")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<Play className="h-6 w-6" />} label={t("tutorial.page.actions.nodeRun")} />
    </div>
  );
}

/** Intent — chat → AI detects → suggests a workspace action. */
export function IntentScenarioDiagram() {
  const { t } = useT();
  return (
    <div className="flex w-full max-w-md items-start justify-center gap-2 py-6">
      <Node icon={<MessageSquare className="h-6 w-6" />} label={t("tutorial.page.intent.nodeChat")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<Sparkles className="h-6 w-6" />} label={t("tutorial.page.intent.nodeDetect")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<Play className="h-6 w-6" />} label={t("tutorial.page.intent.nodeSuggest")} />
    </div>
  );
}

/** Agent — plan-and-execute flow. */
export function AgentFlowDiagram() {
  const { t } = useT();
  return (
    <div className="flex w-full max-w-md items-start justify-center gap-2 py-6">
      <Node icon={<Sparkles className="h-6 w-6" />} label={t("tutorial.page.agent.nodeGoal")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<ListChecks className="h-6 w-6" />} label={t("tutorial.page.agent.nodePlan")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<Bot className="h-6 w-6" />} label={t("tutorial.page.agent.nodeRun")} />
      <div className="pt-3.5"><Arrow /></div>
      <Node icon={<FileText className="h-6 w-6" />} label={t("tutorial.page.agent.nodeAnswer")} />
    </div>
  );
}

// ── UI mockups ───────────────────────────────────────────────────────────────

/** Chat — a plain question and answer. */
export function ChatDemo() {
  const { t } = useT();
  return (
    <DemoFrame>
      <div className="flex flex-col gap-2">
        <div className="self-end max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-xs text-accent-foreground">
          {t("tutorial.page.chat.user")}
        </div>
        <div className="self-start max-w-[88%] rounded-2xl rounded-bl-sm border border-border bg-surface-3 px-3 py-2 text-xs leading-relaxed text-foreground">
          {t("tutorial.page.chat.assistant")}
        </div>
      </div>
    </DemoFrame>
  );
}

/** Attach — the composer with file chips. */
export function AttachDemo() {
  const { t } = useT();
  const chips = [
    { icon: <FileText className="h-3.5 w-3.5 text-muted-foreground" />, name: "report.pdf" },
    { icon: <Layers className="h-3.5 w-3.5 text-accent" />, name: "data.csv" },
  ];
  return (
    <DemoFrame>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.name}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-3 px-2 py-1 text-xs text-foreground"
            >
              {c.icon}
              {c.name}
            </span>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-surface-3 px-3 py-2 text-xs text-muted-foreground">
          {t("tutorial.page.attach.prompt")}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          <Globe className="h-3.5 w-3.5" />
          <Bot className="h-3.5 w-3.5" />
        </div>
      </div>
    </DemoFrame>
  );
}

/** Templates — a structured run document. */
export function TemplateDemo() {
  const { t } = useT();
  return (
    <DemoFrame>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Play className="h-3.5 w-3.5 fill-current" />
          </span>
          <span className="text-xs font-semibold text-foreground">
            {t("tutorial.page.templates.runName")}
          </span>
        </div>
        <div className="rounded-lg border border-border bg-surface-3 p-3">
          <div className="mb-2 h-2 w-1/3 rounded bg-accent/40" />
          <div className="mb-1.5 h-1.5 w-full rounded bg-border-strong" />
          <div className="mb-1.5 h-1.5 w-11/12 rounded bg-border-strong" />
          <div className="mb-3 h-1.5 w-3/4 rounded bg-border-strong" />
          <div className="mb-1.5 h-2 w-1/4 rounded bg-accent/40" />
          <div className="mb-1.5 h-1.5 w-full rounded bg-border-strong" />
          <div className="h-1.5 w-5/6 rounded bg-border-strong" />
        </div>
      </div>
    </DemoFrame>
  );
}

/** Evidence — real EvidenceBadge components plus a claim checklist. */
export function EvidenceDemo() {
  const { t } = useT();
  const claims = [
    { status: "supported" as const, text: t("tutorial.page.evidence.claim1") },
    { status: "partially_supported" as const, text: t("tutorial.page.evidence.claim2") },
    { status: "unsupported" as const, text: t("tutorial.page.evidence.claim3") },
  ];
  return (
    <DemoFrame>
      <div className="flex flex-col gap-2">
        {claims.map((c) => (
          <div
            key={c.text}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-3 px-3 py-2"
          >
            <span className="text-xs text-foreground">{c.text}</span>
            <EvidenceBadge status={c.status} showLabel />
          </div>
        ))}
      </div>
    </DemoFrame>
  );
}

/** Reports & dashboard — a couple of live stat cards. */
export function DashboardDemo() {
  const { t } = useT();
  return (
    <DemoFrame>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-surface-3 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              {t("tutorial.page.reports.statLabel")}
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">+12.4%</div>
          </div>
          <div className="rounded-lg border border-border bg-surface-3 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Flag className="h-3 w-3" />
              {t("tutorial.page.reports.queueLabel")}
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">3</div>
          </div>
        </div>
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-surface-3 p-3">
          {[40, 65, 50, 80, 60, 95, 72].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-accent/50"
              style={{ height: `${(h * 0.5).toString()}px` }}
            />
          ))}
        </div>
      </div>
    </DemoFrame>
  );
}

/** Small inline check used by section bodies. */
export function CheckLine({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-start gap-2">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      <span>{children}</span>
    </span>
  );
}
