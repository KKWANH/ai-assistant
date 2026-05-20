/** Guided-tour step definitions — chat-first IA. `target` matches a `data-tour` attribute. */
import type { TranslationKey } from "../../lib/i18n/en";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Optional `data-tour` value to spotlight on screen. */
  target?: string;
}

type TFn = (key: TranslationKey) => string;

export function getTourSteps(t: TFn): TourStep[] {
  return [
    {
      id: "welcome",
      title: t("tutorial.welcome.title"),
      body: t("tutorial.welcome.body"),
    },
    {
      id: "new-chat",
      title: t("tutorial.newChat.title"),
      body: t("tutorial.newChat.body"),
      target: "new-chat",
    },
    {
      id: "workspaces",
      title: t("tutorial.workspaces.title"),
      body: t("tutorial.workspaces.body"),
      target: "new-workspace",
    },
    {
      id: "run",
      title: t("tutorial.run.title"),
      body: t("tutorial.run.body"),
    },
    {
      id: "evidence",
      title: t("tutorial.evidence.title"),
      body: t("tutorial.evidence.body"),
      target: "inspector-toggle",
    },
    {
      id: "command",
      title: t("tutorial.command.title"),
      body: t("tutorial.command.body"),
      target: "command-hint",
    },
    {
      id: "done",
      title: t("tutorial.done.title"),
      body: t("tutorial.done.body"),
    },
  ];
}
