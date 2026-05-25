/**
 * Localized name + description for the 5 built-in templates.
 *
 * The server ships templates with Korean copy hardcoded in
 * apps/server/src/runs/templates.ts. Doing locale-aware response
 * generation on the server would be more invasive (need to look up
 * the account's locale on every templates call) than just mapping
 * the stable template id → an i18n key on the web. So that's what
 * this helper does.
 *
 * Falls through to template.name / template.description for user-
 * defined or custom templates that don't have an i18n key.
 */
import type { Template } from "@ariadne/shared";
import type { TranslationKey } from "./i18n/en";

const KNOWN_IDS = new Set<string>([
  "research-brief",
  "lecture-brief",
  "investment-decision-memo",
  "job-search-review",
  "source-audit",
]);

export function templateName(
  template: Template,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (KNOWN_IDS.has(template.id)) {
    return t(`template.${template.id}.name` as TranslationKey);
  }
  return template.name;
}

export function templateDescription(
  template: Template,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (KNOWN_IDS.has(template.id)) {
    return t(`template.${template.id}.description` as TranslationKey);
  }
  return template.description ?? "";
}
