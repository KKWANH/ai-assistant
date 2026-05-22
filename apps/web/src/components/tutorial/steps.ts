/** Guided-tour step definitions — chat-first IA. `target` matches a `data-tour` attribute.
 *  The overlay is the lightweight "where is it" orientation; the deeper "what is
 *  it and why" lives on the /tutorial page, which the last step links to. */
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
      id: "composer",
      title: t("tutorial.composer.title"),
      body: t("tutorial.composer.body"),
      target: "composer",
    },
    {
      id: "workspaces",
      title: t("tutorial.workspaces.title"),
      body: t("tutorial.workspaces.body"),
      target: "workspaces-section",
    },
    {
      id: "command",
      title: t("tutorial.command.title"),
      body: t("tutorial.command.body"),
      target: "command-hint",
    },
    {
      id: "help",
      title: t("tutorial.help.title"),
      body: t("tutorial.help.body"),
      target: "help-button",
    },
    {
      id: "done",
      title: t("tutorial.done.title"),
      body: t("tutorial.done.body"),
    },
  ];
}
