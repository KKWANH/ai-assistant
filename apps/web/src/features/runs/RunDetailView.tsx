import { useParams, useNavigate } from "react-router-dom";
import {
  Play,
  Clock,
  FileText,
  ShieldCheck,
  AlertTriangle,
  FolderOpen,
  Loader2,
  DollarSign,
  ArrowLeft,
} from "lucide-react";
import {
  useRun,
  useRunBrief,
  useRunEvidence,
  useRunDiff,
  useWorkspace,
} from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Badge } from "../../components/ui/Badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/Tabs";
import { TraceTimeline } from "../../components/ui/TraceTimeline";
import { EvidenceBadge } from "../../components/ui/EvidenceBadge";
import { Card } from "../../components/ui/Card";
import { TokenEstimate } from "../../components/ui/TokenEstimate";
import { useUIStore } from "../../lib/store";
import type { Claim, TraceEvent } from "@ariadne/shared";

// ── Phase progress bar ──────────────────────────────────────────────────────
const PHASES = [
  "scan",
  "manifest",
  "candidate_select",
  "context_approved",
  "focused_read",
  "brief",
  "claims",
  "evidence",
  "diff",
  "artifacts",
];

const PHASE_LABELS: Record<string, string> = {
  scan: "Scanning",
  manifest: "Manifest",
  candidate_select: "Selecting context",
  context_approved: "Context approved",
  focused_read: "Reading files",
  brief: "Generating brief",
  claims: "Extracting claims",
  evidence: "Mapping evidence",
  unsupported: "Unsupported claims",
  diff: "Computing diff",
  artifacts: "Writing artifacts",
};

function PhaseProgress({ trace }: { trace: TraceEvent[] }) {
  const lastEvent = trace.at(-1);
  const currentPhase = lastEvent?.phase ?? "";
  const currentIdx = PHASES.indexOf(currentPhase);
  const label = PHASE_LABELS[currentPhase] ?? currentPhase;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
        <span className="text-xs text-foreground">{label}…</span>
      </div>
      <div className="flex gap-0.5">
        {PHASES.map((ph, i) => (
          <div
            key={ph}
            className={[
              "h-1 flex-1 rounded-full transition-colors",
              i < currentIdx
                ? "bg-accent"
                : i === currentIdx
                  ? "bg-accent/60"
                  : "bg-surface-3",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}

// ── Brief tab ────────────────────────────────────────────────────────────────
function BriefTab({ runId }: { runId: string }) {
  const { data: brief, isLoading } = useRunBrief(runId, true);
  const { t } = useT();
  if (isLoading)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        {t("runs.detail.generatingBrief")}
      </p>
    );
  if (!brief?.markdown)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        {t("runs.detail.briefPending")}
      </p>
    );
  return (
    <article
      className="prose text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: mdToHtml(brief.markdown) }}
    />
  );
}

/** Minimal markdown → HTML for brief preview (no external dep). */
function mdToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[hlp])(.+)$/gm, "$1")
    .replace(/^<li>/gm, "<ul><li>")
    .replace(/<\/li>(?!\n<li>)/g, "</li></ul>")
    .trim();
}

// ── Evidence tab ─────────────────────────────────────────────────────────────
function EvidenceTab({ runId }: { runId: string }) {
  const { data: pack, isLoading } = useRunEvidence(runId, true);
  const { selectedClaimId, setSelectedClaimId } = useUIStore();
  const { t } = useT();

  if (isLoading)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        {t("runs.detail.loadingEvidence")}
      </p>
    );
  if (!pack?.claims.length)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        {t("runs.detail.evidencePending")}
      </p>
    );

  const selectedClaim = pack.claims.find((c) => c.id === selectedClaimId);

  return (
    <div className="flex gap-4 h-[calc(100vh-18rem)] overflow-hidden">
      {/* Claims list */}
      <div className="w-72 shrink-0 overflow-y-auto flex flex-col gap-1">
        {pack.claims.map((claim) => (
          <ClaimRow
            key={claim.id}
            claim={claim}
            selected={claim.id === selectedClaimId}
            onClick={() => setSelectedClaimId(claim.id === selectedClaimId ? null : claim.id)}
          />
        ))}
      </div>
      {/* Source inspector */}
      <div className="flex-1 overflow-y-auto">
        {selectedClaim ? (
          <SourceInspector claim={selectedClaim} />
        ) : (
          <div className="flex items-center justify-center h-32">
            <p className="text-xs text-muted-foreground">
              {t("runs.detail.selectClaim")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClaimRow({
  claim,
  selected,
  onClick,
}: {
  claim: Claim;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2 rounded-lg border transition-colors",
        selected
          ? "border-accent bg-accent/5"
          : "border-border hover:border-border-strong hover:bg-surface-2",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 mb-1">
        <EvidenceBadge status={claim.status} />
      </div>
      <p className="text-xs text-foreground line-clamp-2">{claim.text}</p>
    </button>
  );
}

function SourceInspector({ claim }: { claim: Claim }) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">{t("runs.detail.claim")}</p>
        <p className="text-sm text-foreground">{claim.text}</p>
        <div className="mt-2">
          <EvidenceBadge status={claim.status} />
        </div>
      </div>
      {claim.sources.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            {t("runs.detail.sourceCount", { n: claim.sources.length })}
          </p>
          <div className="flex flex-col gap-2">
            {claim.sources.map((src, i) => (
              <Card key={i} className="px-3 py-2.5">
                <p className="font-mono text-xs text-muted-foreground">
                  {src.path}
                </p>
                {src.locator && (
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                    {src.locator}
                  </p>
                )}
                {src.excerpt && (
                  <blockquote className="mt-1.5 text-xs text-foreground border-l-2 border-border pl-2 italic">
                    &ldquo;{src.excerpt}&rdquo;
                  </blockquote>
                )}
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("runs.detail.noSources")}</p>
      )}
      {claim.reason && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">{t("runs.detail.reason")}</p>
          <p className="text-xs text-foreground">{claim.reason}</p>
        </div>
      )}
      {claim.conservativeRewrite && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            {t("runs.detail.conservativeRewrite")}
          </p>
          <Card className="px-3 py-2.5 bg-surface-2">
            <p className="text-xs text-foreground">{claim.conservativeRewrite}</p>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Unsupported tab ───────────────────────────────────────────────────────────
function UnsupportedTab({ runId }: { runId: string }) {
  const { data: pack, isLoading } = useRunEvidence(runId, true);
  const { t } = useT();
  if (isLoading)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">{t("runs.detail.loading.short")}</p>
    );
  const unsupported =
    pack?.claims.filter((c) => c.status === "unsupported") ?? [];
  if (unsupported.length === 0)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        {t("runs.detail.noUnsupported")}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {unsupported.map((claim) => (
        <Card key={claim.id} className="px-4 py-3 flex flex-col gap-2">
          <EvidenceBadge status="unsupported" />
          <p className="text-sm text-foreground">{claim.text}</p>
          {claim.reason && (
            <p className="text-xs text-muted-foreground">{claim.reason}</p>
          )}
          {claim.missingEvidence && (
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
              <span>{t("runs.detail.missingEvidence", { text: claim.missingEvidence })}</span>
            </div>
          )}
          {claim.conservativeRewrite && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {t("runs.detail.conservativeRewrite")}
              </p>
              <div className="bg-surface-2 rounded-md px-3 py-2 border border-border">
                <p className="text-xs text-foreground italic">
                  {claim.conservativeRewrite}
                </p>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Sources tab ───────────────────────────────────────────────────────────────
function SourcesTab({ selectedFiles }: { selectedFiles: string[] }) {
  const { t } = useT();
  if (selectedFiles.length === 0)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        {t("runs.detail.noFiles")}
      </p>
    );
  return (
    <div className="flex flex-col gap-1">
      {selectedFiles.map((path) => (
        <div
          key={path}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface-2"
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-mono text-xs text-foreground">{path}</span>
        </div>
      ))}
    </div>
  );
}

// ── Diff tab ──────────────────────────────────────────────────────────────────
function DiffTab({ runId }: { runId: string }) {
  const { data: diff, isLoading } = useRunDiff(runId, true);
  const { t } = useT();
  if (isLoading)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">{t("runs.detail.loading.short")}</p>
    );
  if (!diff)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        {t("runs.detail.noDiff")}
      </p>
    );
  if (!diff.previousRunId)
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        {t("runs.detail.firstRun")}
      </p>
    );

  const sections: { label: string; items: string[]; color?: string }[] = [
    { label: t("runs.diff.newFiles"), items: diff.newFiles, color: "text-success" },
    { label: t("runs.diff.removedFiles"), items: diff.removedFiles, color: "text-destructive" },
    { label: t("runs.diff.modifiedFiles"), items: diff.modifiedFiles, color: "text-warning" },
    { label: t("runs.diff.newClaims"), items: diff.newClaims, color: "text-success" },
    { label: t("runs.diff.removedClaims"), items: diff.removedClaims, color: "text-destructive" },
    { label: t("runs.diff.changedConclusions"), items: diff.changedConclusions },
    { label: t("runs.diff.newUnsupported"), items: diff.newUnsupported, color: "text-warning" },
    { label: t("runs.diff.resolvedUnsupported"), items: diff.resolvedUnsupported, color: "text-success" },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {diff.summary && (
        <Card className="px-4 py-3 bg-surface-2">
          <p className="text-xs font-medium text-muted-foreground mb-1">{t("runs.detail.diffSummary")}</p>
          <p className="text-sm text-foreground">{diff.summary}</p>
        </Card>
      )}
      {sections.map((sec) => (
        <section key={sec.label}>
          <h3 className="text-xs font-medium text-muted-foreground mb-1.5">
            {sec.label}{" "}
            <span className="text-foreground font-mono">({sec.items.length})</span>
          </h3>
          <div className="flex flex-col gap-1">
            {sec.items.map((item) => (
              <div
                key={item}
                className="px-3 py-1.5 rounded-md bg-surface-2 border border-border"
              >
                <span className={["font-mono text-xs", sec.color ?? "text-foreground"].join(" ")}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function RunDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const { data: run, isLoading } = useRun(id ?? "");
  const { data: workspace } = useWorkspace(run?.workspaceId ?? "");

  if (isLoading || !run) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">{t("runs.detail.loading")}</p>
      </div>
    );
  }

  const duration =
    run.completedAt && run.startedAt
      ? Math.round(
          (new Date(run.completedAt).getTime() -
            new Date(run.startedAt).getTime()) /
            1000
        )
      : null;

  const isActive =
    run.status === "scanning" ||
    run.status === "generating" ||
    run.status === "created";

  return (
    <div className="flex flex-col gap-0 h-full overflow-hidden">
      {/* Run header */}
      <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
        {/* Step indicator + back nav */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                run.workspaceId
                  ? navigate(`/workspaces/${run.workspaceId}`)
                  : navigate("/workspaces")
              }
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {workspace?.name ?? t("nav.workspaces")}
            </button>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={[
                    "h-1.5 rounded-full transition-all",
                    i < 3 ? "w-4 bg-accent" : "w-5 bg-accent",
                  ].join(" ")}
                />
              ))}
              <span className="text-xs font-mono text-muted-foreground ml-1">
                {t("runs.step", { step: 3, total: 3 })}
              </span>
            </div>
          </div>
          <Badge variant={run.status} dot>
            {(
              {
                created: t("badge.status.created"),
                scanning: t("badge.status.scanning"),
                context_pick: t("badge.status.contextPick"),
                generating: t("badge.status.generating"),
                completed: t("badge.status.completed"),
                failed: t("badge.status.failed"),
              } as Record<string, string>
            )[run.status] ?? run.status}
          </Badge>
        </div>

        {/* Context banner */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface-2 mb-2">
          <Play className="h-3.5 w-3.5 text-accent shrink-0" />
          <span className="text-xs text-muted-foreground">
            {workspace
              ? t("runs.youCreatedIn", { template: run.templateName, workspace: workspace.name })
              : t("runs.youCreated", { template: run.templateName })}
          </span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Play className="h-3.5 w-3.5" />
              <span>{t("runs.detail.run")}</span>
              <span className="font-mono">{run.id.slice(0, 12)}…</span>
            </div>
            <h1 className="text-base font-semibold text-foreground">
              {run.templateName}
            </h1>
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
          {run.model && (
            <span className="font-mono">{run.model}</span>
          )}
          {run.selectedFiles.length > 0 && (
            <span className="flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              {t("runs.detail.files", { n: run.selectedFiles.length })}
            </span>
          )}
          {run.evidenceCount > 0 && (
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-success" />
              {t("runs.detail.claims", { n: run.evidenceCount })}
            </span>
          )}
          {run.unsupportedCount > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" />
              {t("runs.detail.unsupportedCount", { n: run.unsupportedCount })}
            </span>
          )}
          {run.tokenEstimate > 0 && (
            <TokenEstimate tokens={run.tokenEstimate} />
          )}
          {run.usage && (
            <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              <span>
                {run.usage.inputTokens.toLocaleString()} in · {run.usage.outputTokens.toLocaleString()} out
                {" · "}
                {run.usage.costUsd === 0
                  ? t("runs.detail.costLocal")
                  : `$${run.usage.costUsd.toFixed(4)}`}
              </span>
            </span>
          )}
          {duration !== null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {duration}s
            </span>
          )}
          {run.artifacts.brief && (
            <span className="flex items-center gap-1 font-mono">
              <FileText className="h-3 w-3" />
              {run.artifacts.brief}
            </span>
          )}
        </div>

        {/* Phase progress (while active) */}
        {isActive && run.trace.length > 0 && (
          <div className="mt-3">
            <PhaseProgress trace={run.trace} />
          </div>
        )}

        {run.status === "failed" && run.error && (
          <div className="mt-2 px-3 py-2 rounded-md border border-destructive/30 bg-destructive/5">
            <p className="text-xs text-destructive">{run.error}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="brief" className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="px-5 shrink-0">
          <TabsTrigger value="brief">{t("runs.detail.brief")}</TabsTrigger>
          <TabsTrigger value="evidence">
            {t("runs.detail.evidence")}{run.evidenceCount > 0 ? ` (${run.evidenceCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="unsupported">
            {t("runs.detail.unsupported")}{run.unsupportedCount > 0 ? ` (${run.unsupportedCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="sources">{t("runs.detail.sources")}</TabsTrigger>
          <TabsTrigger value="diff">{t("runs.detail.diff")}</TabsTrigger>
          <TabsTrigger value="trace">{t("runs.detail.trace")}</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <TabsContent value="brief">
            <BriefTab runId={run.id} />
          </TabsContent>
          <TabsContent value="evidence">
            <EvidenceTab runId={run.id} />
          </TabsContent>
          <TabsContent value="unsupported">
            <UnsupportedTab runId={run.id} />
          </TabsContent>
          <TabsContent value="sources">
            <SourcesTab selectedFiles={run.selectedFiles} />
          </TabsContent>
          <TabsContent value="diff">
            <DiffTab runId={run.id} />
          </TabsContent>
          <TabsContent value="trace">
            <TraceTimeline events={run.trace} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
