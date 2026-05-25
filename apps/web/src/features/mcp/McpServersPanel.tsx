/**
 * MCP servers settings panel.
 *
 *   - List registered MCP servers + connection status badge.
 *   - Add a new server (name, command, args, env).
 *   - Test a server's connection (spawns the child and lists tools).
 *   - Enable/disable.
 *   - Remove.
 *
 * Write actions go through routes that are local-only. The panel
 * surfaces "Local only" copy near the form so remote sessions don't
 * try to add servers and get a confusing 403.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Plug,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Network,
  AlertCircle,
} from "lucide-react";
import type { McpTool } from "@ariadne/shared";
import {
  listMcpServers,
  createMcpServer,
  deleteMcpServer,
  updateMcpServer,
  testMcpServer,
  listMcpTools,
  type McpServerWithStatus,
} from "../../lib/api";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

const mcpKey = ["mcp-servers"] as const;

interface AddForm {
  name: string;
  command: string;
  argsRaw: string; // newline-separated
  envRaw: string; // KEY=VALUE per line
}

const emptyForm: AddForm = { name: "", command: "npx", argsRaw: "", envRaw: "" };

function parseArgs(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k) env[k] = v;
  }
  return env;
}

function ConnectionBadge({ server, lastTest }: {
  server: McpServerWithStatus;
  lastTest?: { ok: boolean; detail?: string };
}) {
  const { t } = useT();
  if (!server.enabled) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
        <Plug className="h-3 w-3" /> {t("mcp.badge.disabled")}
      </span>
    );
  }
  if (lastTest) {
    return lastTest.ok ? (
      <span className="inline-flex items-center gap-1 text-2xs text-accent">
        <CheckCircle2 className="h-3 w-3" /> {t("mcp.badge.ok")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-2xs text-destructive" title={lastTest.detail}>
        <XCircle className="h-3 w-3" /> {t("mcp.badge.failed")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
      <Plug className="h-3 w-3" /> {server.connected ? t("mcp.badge.connected") : t("mcp.badge.untested")}
    </span>
  );
}

function McpServerCard({
  server,
}: {
  server: McpServerWithStatus;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"test" | "delete" | "toggle" | null>(null);
  const [lastTest, setLastTest] = useState<{ ok: boolean; detail?: string } | undefined>();
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<McpTool[] | null>(null);

  async function handleTest(): Promise<void> {
    setBusy("test");
    try {
      const status = await testMcpServer(server.id);
      setLastTest({ ok: status.connected, detail: status.lastError });
      if (status.connected) {
        toast({
          title: t("mcp.test.ok"),
          description: t("mcp.test.toolCount", { n: (status.toolCount ?? 0).toString() }),
          variant: "success",
        });
      } else {
        toast({
          title: t("mcp.test.failed"),
          description: status.lastError ?? "",
          variant: "error",
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleToggle(): Promise<void> {
    setBusy("toggle");
    try {
      await updateMcpServer(server.id, { enabled: !server.enabled });
      await queryClient.invalidateQueries({ queryKey: mcpKey });
    } catch (err) {
      toast({
        title: t("common.error"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(): Promise<void> {
    setBusy("delete");
    try {
      await deleteMcpServer(server.id);
      await queryClient.invalidateQueries({ queryKey: mcpKey });
    } catch (err) {
      toast({
        title: t("common.error"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleTools(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (tools !== null) return;
    try {
      const resp = await listMcpTools(server.id);
      setTools(resp.tools);
    } catch (err) {
      toast({
        title: t("mcp.tools.fetchFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
      setTools([]);
    }
  }

  return (
    <Card className="p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Network className="h-3.5 w-3.5 text-accent shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{server.name}</span>
            <ConnectionBadge server={server} lastTest={lastTest} />
          </div>
          <div className="mt-1 text-2xs text-muted-foreground font-mono break-all">
            {server.command} {server.args.join(" ")}
          </div>
          {/* Inline persistent error — without this the only place the
              user sees WHY a test failed is the toast (which dismisses
              in ~3s) or the badge tooltip (hidden on mobile). */}
          {lastTest && !lastTest.ok && lastTest.detail && (
            <div className="mt-2 rounded-md bg-destructive/10 border border-destructive/30 px-2.5 py-1.5 flex items-start gap-1.5">
              <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
              <pre className="text-2xs text-destructive whitespace-pre-wrap break-words leading-relaxed font-mono">
                {lastTest.detail}
              </pre>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleTest()}
            loading={busy === "test"}
            disabled={!server.enabled}
          >
            {t("mcp.button.test")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleToggle()}
            loading={busy === "toggle"}
          >
            {server.enabled ? t("mcp.button.disable") : t("mcp.button.enable")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleDelete()}
            loading={busy === "delete"}
            aria-label={t("mcp.button.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleToggleTools()}
        className="self-start inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? t("mcp.tools.hide") : t("mcp.tools.show")}
      </button>
      {expanded && tools !== null && (
        <div className="rounded-md bg-surface-2 px-3 py-2 text-2xs font-mono text-muted-foreground">
          {tools.length === 0 ? (
            <span>{t("mcp.tools.none")}</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {tools.map((tool) => (
                <li key={tool.name}>
                  <span className="text-foreground">{tool.name}</span>
                  {tool.description && <span> — {tool.description.slice(0, 120)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

export function McpServersPanel() {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: servers, isLoading } = useQuery({
    queryKey: mcpKey,
    queryFn: () => listMcpServers(),
  });
  const [form, setForm] = useState<AddForm>(emptyForm);
  const [adding, setAdding] = useState(false);

  const canAdd = form.name.trim().length > 0 && form.command.trim().length > 0 && !adding;

  async function handleAdd(): Promise<void> {
    if (!canAdd) return;
    setAdding(true);
    try {
      await createMcpServer({
        name: form.name.trim(),
        command: form.command.trim(),
        args: parseArgs(form.argsRaw),
        env: parseEnv(form.envRaw),
      });
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: mcpKey });
      toast({ title: t("mcp.add.added"), variant: "success" });
    } catch (err) {
      toast({
        title: t("mcp.add.failed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <div className="flex items-start gap-2">
        <Network className="h-4 w-4 text-accent mt-0.5" />
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("mcp.panel.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("mcp.panel.subtitle")}</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : (servers ?? []).length === 0 ? (
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("mcp.panel.empty")}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {(servers ?? []).map((s) => (
            <McpServerCard key={s.id} server={s} />
          ))}
        </div>
      )}

      <Card className="p-3 flex flex-col gap-2">
        <div className="text-xs font-medium text-foreground">{t("mcp.add.title")}</div>
        <p className="text-2xs text-muted-foreground">{t("mcp.add.localOnly")}</p>
        <Input
          label={t("mcp.add.nameLabel")}
          placeholder="fs"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          disabled={adding}
        />
        <Input
          label={t("mcp.add.commandLabel")}
          hint={t("mcp.add.commandHint")}
          placeholder="npx"
          value={form.command}
          onChange={(e) => setForm({ ...form, command: e.target.value })}
          disabled={adding}
        />
        <Textarea
          label={t("mcp.add.argsLabel")}
          hint={t("mcp.add.argsHint")}
          placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/Users/you/some-folder"}
          rows={3}
          value={form.argsRaw}
          onChange={(e) => setForm({ ...form, argsRaw: e.target.value })}
          disabled={adding}
        />
        <Textarea
          label={t("mcp.add.envLabel")}
          hint={t("mcp.add.envHint")}
          placeholder="TOKEN=…"
          rows={2}
          value={form.envRaw}
          onChange={(e) => setForm({ ...form, envRaw: e.target.value })}
          disabled={adding}
        />
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => void handleAdd()}
            disabled={!canAdd}
            loading={adding}
          >
            {t("mcp.add.button")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
