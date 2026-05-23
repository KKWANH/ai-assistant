/**
 * Attempts list for one chat — `/chats/:chatId/attempts`.
 *
 * Lists every attempt the agent ever opened in this chat, with status
 * (open / applied / abandoned), file count, timestamps, and click-through
 * to the diff review. Acts as the long-tail companion to the OpenAttemptChip
 * in the composer (which only shows the currently-open one).
 */
import { useParams, Link, useNavigate } from "react-router-dom";
import { Bot, ArrowRight, Check, X, FileText } from "lucide-react";
import { useChatAttempts } from "../../lib/queries";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { useT } from "../../lib/i18n";
import type { AgentAttempt } from "@ariadne/shared";

export function AttemptsListView() {
  const { chatId = "" } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const { data: attempts, isLoading } = useChatAttempts(chatId);

  return (
    <div className="px-5 py-5 max-w-5xl mx-auto flex flex-col gap-4">
      <PageHeader
        icon={<Bot className="h-5 w-5" />}
        title={t("attempts.listTitle")}
        description={t("attempts.listSubtitle")}
        breadcrumb={
          <Link
            to={`/chat/${chatId}`}
            className="hover:text-foreground transition-colors"
          >
            ← {t("attempts.backToChat")}
          </Link>
        }
      />

      {isLoading && (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}

      {!isLoading && (!attempts || attempts.length === 0) && (
        <p className="text-sm text-muted-foreground">
          {t("attempts.listEmpty")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {(attempts ?? []).map((a) => (
          <AttemptCard
            key={a.id}
            attempt={a}
            onOpen={() => navigate(`/attempts/${a.id}/diff`)}
          />
        ))}
      </div>
    </div>
  );
}

function AttemptCard({
  attempt,
  onOpen,
}: {
  attempt: AgentAttempt;
  onOpen: () => void;
}) {
  const { t } = useT();
  const statusBadge = badgeForStatus(attempt.status);
  return (
    <Card
      interactive
      onClick={onOpen}
      className="px-4 py-3 flex items-center gap-3 cursor-pointer"
    >
      <span className={`text-2xs font-medium uppercase tracking-wider px-2 py-1 rounded-md shrink-0 ${statusBadge.classes}`}>
        {statusBadge.icon}
        {t(statusBadge.labelKey as "attempts.status.open")}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground">
          {attempt.fileCount > 0
            ? t("attempts.fileCount", { n: attempt.fileCount })
            : t("attempts.noFiles")}
        </div>
        <div className="text-2xs text-muted-foreground mt-0.5">
          {t("attempts.createdAt", {
            time: new Date(attempt.createdAt).toLocaleString(),
          })}
          {attempt.appliedAt && (
            <> · {t("attempts.appliedAt", { time: new Date(attempt.appliedAt).toLocaleString() })}</>
          )}
          {attempt.abandonedAt && (
            <> · {t("attempts.abandonedAt", { time: new Date(attempt.abandonedAt).toLocaleString() })}</>
          )}
        </div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </Card>
  );
}

function badgeForStatus(status: AgentAttempt["status"]): {
  classes: string;
  icon: React.ReactNode;
  labelKey: string;
} {
  if (status === "open") {
    return {
      classes: "bg-accent/15 text-accent border border-accent/30 flex items-center gap-1",
      icon: <FileText className="h-3 w-3" />,
      labelKey: "attempts.status.open",
    };
  }
  if (status === "applied") {
    return {
      classes: "bg-success/15 text-success border border-success/30 flex items-center gap-1",
      icon: <Check className="h-3 w-3" />,
      labelKey: "attempts.status.applied",
    };
  }
  return {
    classes: "bg-destructive/15 text-destructive border border-destructive/30 flex items-center gap-1",
    icon: <X className="h-3 w-3" />,
    labelKey: "attempts.status.abandoned",
  };
}
