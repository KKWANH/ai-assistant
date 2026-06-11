/**
 * Locale-aware name + description for built-in run templates.
 *
 * The server ships each built-in template with one hardcoded (Korean)
 * name/description; doing locale-aware copy server-side would mean threading
 * the account locale through every templates call. Instead the web maps a
 * built-in template's stable id to an i18n key (`template.<id>.name`). This
 * also covers project-contributed templates — their keys arrive via the project
 * i18n registry — so this helper keeps no per-template id list.
 *
 * Falls through to the template's own name/description for custom templates, or
 * any built-in whose i18n key has no translation.
 */
import type { Template } from "@ariadne/shared";
import type { TranslationKey } from "./i18n/en";

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** The translation for `key`, or null on a miss (t() echoes the key back when
 *  there's no entry). */
function localized(t: T, key: string): string | null {
  const value = t(key as TranslationKey);
  return value === key ? null : value;
}

export function templateName(template: Template, t: T): string {
  const label = template.builtin ? localized(t, `template.${template.id}.name`) : null;
  return label ?? template.name;
}

export function templateDescription(template: Template, t: T): string {
  const label = template.builtin ? localized(t, `template.${template.id}.description`) : null;
  return label ?? template.description ?? "";
}
