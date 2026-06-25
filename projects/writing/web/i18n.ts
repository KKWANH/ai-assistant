/**
 * Writing project i18n — the copy the writing starter card needs, owned by the
 * project. Merged into the core dictionaries by apps/web/src/projects/i18n.ts.
 * Pure data, no imports (stays out of the i18n provider's import cycle).
 */
export const writingMessages: { en: Record<string, string>; ko: Record<string, string> } = {
  en: {
    "workspace.dialog.starterWriting": "Writing",
    "workspace.dialog.starterWritingDesc":
      "A workspace for your writing — criticism, lecture transcripts, essays. Bring drafts; revise, structure, and polish them with writing-focused chat starters and skills.",
  },
  ko: {
    "workspace.dialog.starterWriting": "글쓰기",
    "workspace.dialog.starterWritingDesc":
      "비평·강연록·에세이 등 글쓰기를 위한 워크스페이스. 초고를 올려 다듬고, 구조를 잡고, 톤을 고쳐요. 글쓰기 전용 시작 프롬프트와 스킬 제공.",
  },
};
