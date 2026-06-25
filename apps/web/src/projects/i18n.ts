/**
 * Web i18n registry — merges each example project's owned strings into the
 * core dictionaries so core's en.ts / ko.ts carry no vertical-specific copy.
 *
 * Imports ONLY the projects' plain string bundles, never their React modules,
 * so it stays out of the i18n provider's import cycle (the provider imports
 * this; a project view imports the provider's useT()).
 */
import { lectureMessages } from "@projects/lecture/web/i18n";
import { writingMessages } from "@projects/writing/web/i18n";

export const PROJECT_MESSAGES: { en: Record<string, string>; ko: Record<string, string> } = {
  en: { ...lectureMessages.en, ...writingMessages.en },
  ko: { ...lectureMessages.ko, ...writingMessages.ko },
};
