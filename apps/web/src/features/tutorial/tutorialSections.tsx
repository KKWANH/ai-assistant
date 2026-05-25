/**
 * Content for the /tutorial page — nine sections, each pairing a short
 * plain-language explanation with one visual (SVG art, a flow diagram, or an
 * inert UI mockup). `getTutorialSections(t)` is called with the translator so
 * every string comes from the i18n dictionaries.
 */
import type { ReactNode } from "react";
import type { TranslationKey } from "../../lib/i18n/en";
import {
  WelcomeArt,
  ReadyArt,
  WorkspaceDiagram,
  AgentFlowDiagram,
  ActionsScenarioDiagram,
  IntentScenarioDiagram,
  ChatDemo,
  AttachDemo,
  TemplateDemo,
  EvidenceDemo,
  DashboardDemo,
} from "./tutorialVisuals";

export interface TutorialSection {
  id: string;
  title: string;
  body: ReactNode;
  visual: ReactNode;
}

type TFn = (key: TranslationKey) => string;

/** Two short paragraphs of section copy. */
function Body({ paras }: { paras: string[] }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export function getTutorialSections(t: TFn): TutorialSection[] {
  return [
    {
      id: "welcome",
      title: t("tutorial.page.welcome.title"),
      body: <Body paras={[t("tutorial.page.welcome.p1"), t("tutorial.page.welcome.p2")]} />,
      visual: <WelcomeArt />,
    },
    {
      id: "chat",
      title: t("tutorial.page.chat.title"),
      body: <Body paras={[t("tutorial.page.chat.p1"), t("tutorial.page.chat.p2")]} />,
      visual: <ChatDemo />,
    },
    {
      id: "attach",
      title: t("tutorial.page.attach.title"),
      body: <Body paras={[t("tutorial.page.attach.p1"), t("tutorial.page.attach.p2")]} />,
      visual: <AttachDemo />,
    },
    {
      id: "workspaces",
      title: t("tutorial.page.workspaces.title"),
      body: <Body paras={[t("tutorial.page.workspaces.p1"), t("tutorial.page.workspaces.p2")]} />,
      visual: <WorkspaceDiagram />,
    },
    {
      id: "templates",
      title: t("tutorial.page.templates.title"),
      body: <Body paras={[t("tutorial.page.templates.p1"), t("tutorial.page.templates.p2")]} />,
      visual: <TemplateDemo />,
    },
    {
      id: "evidence",
      title: t("tutorial.page.evidence.title"),
      body: <Body paras={[t("tutorial.page.evidence.p1"), t("tutorial.page.evidence.p2")]} />,
      visual: <EvidenceDemo />,
    },
    {
      id: "actions",
      title: t("tutorial.page.actions.title"),
      body: <Body paras={[t("tutorial.page.actions.p1"), t("tutorial.page.actions.p2")]} />,
      visual: <ActionsScenarioDiagram />,
    },
    {
      id: "intent",
      title: t("tutorial.page.intent.title"),
      body: <Body paras={[t("tutorial.page.intent.p1"), t("tutorial.page.intent.p2")]} />,
      visual: <IntentScenarioDiagram />,
    },
    {
      id: "agent",
      title: t("tutorial.page.agent.title"),
      body: <Body paras={[t("tutorial.page.agent.p1"), t("tutorial.page.agent.p2")]} />,
      visual: <AgentFlowDiagram />,
    },
    {
      id: "reports",
      title: t("tutorial.page.reports.title"),
      body: <Body paras={[t("tutorial.page.reports.p1"), t("tutorial.page.reports.p2")]} />,
      visual: <DashboardDemo />,
    },
    {
      id: "mcp",
      title: t("tutorial.page.mcp.title"),
      body: <Body paras={[t("tutorial.page.mcp.p1"), t("tutorial.page.mcp.p2"), t("tutorial.page.mcp.p3")]} />,
      // Reuse the agent flow diagram — MCP is "agent calls an external
      // tool", same shape, no need to draw a separate visual yet.
      visual: <AgentFlowDiagram />,
    },
    {
      id: "ready",
      title: t("tutorial.page.ready.title"),
      body: <Body paras={[t("tutorial.page.ready.p1"), t("tutorial.page.ready.p2")]} />,
      visual: <ReadyArt />,
    },
  ];
}
