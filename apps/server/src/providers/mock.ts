import type { AiProvider, ProviderUsage, CompleteRequest, CompleteWithImagesRequest } from "./index.js";

/** Tiny async delay used by the mock streaming implementation. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Mock provider — produces schema-correct, data-aware output for every run
 * step so a full run completes end-to-end with no API key configured.
 *
 * It discriminates first by the `json` flag (only the Brief step is a
 * free-text call) and then by a distinctive phrase in the system prompt.
 * Output echoes real file paths parsed out of the prompt, so the Context
 * Pick and Evidence screens show genuine workspace data rather than canned
 * placeholders.
 */

interface ManifestEntry {
  path: string;
  extension?: string;
  headings?: string[];
  csvHeaders?: string[];
  sensitive?: boolean;
}

export class MockProvider implements AiProvider {
  readonly id = "mock" as const;

  async complete(req: CompleteRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    const sys = req.system.toLowerCase();
    const fullPrompt = req.system + "\n" + req.prompt;

    let text: string;
    // Free-text (non-JSON) calls: a chat reply or a Brief.
    if (!req.json) {
      text = sys.includes("ariadne's assistant")
        ? this.chatReply(req.system, req.prompt)
        : this.brief(req.system, req.prompt);
    } else if (sys.includes("agent planner") || sys.includes("plan-and-execute")) {
      text = this.agentPlan(req.prompt);
    } else if (sys.includes("context-selection")) {
      text = this.candidates(req.prompt);
    } else if (sys.includes("evidence analyst")) {
      text = this.claims(req.prompt);
    } else if (sys.includes("diff analyst")) {
      text = this.diff();
    } else {
      text = "{}";
    }

    const usage: ProviderUsage = {
      inputTokens: Math.ceil(fullPrompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
    return { text, usage };
  }

  async completeStream(
    req: CompleteRequest,
    onDelta: (delta: string) => void,
    onStatus?: (status: string) => void,
  ): Promise<{ text: string; usage?: ProviderUsage }> {
    // Get the full response first (same as complete)
    const { text, usage } = await this.complete(req);

    if (onStatus) onStatus("Generating…");

    // Split into ~word chunks and emit with a small delay for realism
    const words = text.split(/(\s+)/);
    for (let i = 0; i < words.length; i++) {
      if (req.signal?.aborted) break;
      const chunk = words[i] ?? "";
      if (chunk) {
        onDelta(chunk);
        await sleep(18);
      }
    }

    return { text, usage };
  }

  async completeWithImages(req: CompleteWithImagesRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    const imageCount = req.images.length;
    const text = req.system.toLowerCase().includes("ariadne's assistant")
      ? this.chatReply(req.system, req.prompt) +
        `\n\n_(${imageCount.toString()} image(s) attached — a vision-capable provider would describe them.)_`
      : `[Mock vision response] This image appears to contain visual content relevant to the research context. ${imageCount.toString()} image(s) were provided. In a real run, the configured AI provider would describe the image content in detail for evidence documentation purposes.`;
    const fullPrompt = req.system + "\n" + req.prompt;
    const usage: ProviderUsage = {
      inputTokens: Math.ceil(fullPrompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
    return { text, usage };
  }

  // -- candidate selection ---------------------------------------------------

  private candidates(prompt: string): string {
    const files = this.parseManifest(prompt);
    // Prefer non-sensitive files; keep the manifest order otherwise.
    const ranked = [...files].sort(
      (a, b) => Number(Boolean(a.sensitive)) - Number(Boolean(b.sensitive))
    );
    const picked = ranked.slice(0, Math.min(8, ranked.length));
    return JSON.stringify({
      candidates: picked.map((f) => ({ path: f.path, reason: this.reasonFor(f) })),
    });
  }

  private reasonFor(f: ManifestEntry): string {
    if (f.headings && f.headings.length > 0) {
      return `Section headings (${f.headings.slice(0, 3).join(", ")}) align with the requested topic.`;
    }
    if (f.csvHeaders && f.csvHeaders.length > 0) {
      return `Structured columns (${f.csvHeaders.slice(0, 3).join(", ")}) provide quantitative support.`;
    }
    return `Filename "${f.path}" is topically relevant to this task.`;
  }

  private parseManifest(prompt: string): ManifestEntry[] {
    const marker = "Manifest:";
    const idx = prompt.indexOf(marker);
    if (idx === -1) return [];
    try {
      const arr: unknown = JSON.parse(prompt.slice(idx + marker.length).trim());
      return Array.isArray(arr) ? (arr as ManifestEntry[]) : [];
    } catch {
      return [];
    }
  }

  // -- claim extraction ------------------------------------------------------

  private claims(prompt: string): string {
    const files = this.parseSourcePaths(prompt, /--- FILE: (.+?) ---/g);
    const f0 = files[0];
    const f1 = files[1] ?? files[0];
    const claims: unknown[] = [];

    if (f0) {
      claims.push({
        text: "The selected source material consistently supports the central argument of the brief.",
        status: "supported",
        sources: [
          {
            path: f0,
            locator: "opening section",
            excerpt: "The document states its core position directly in the opening lines.",
          },
        ],
      });
      claims.push({
        text: "The framing reflects a broader shift in how the topic has been understood over time.",
        status: "inferred",
        sources: [
          {
            path: f0,
            locator: "throughout",
            excerpt: "The narrative implies an evolution although it is not stated outright.",
          },
        ],
      });
    }
    if (f1) {
      claims.push({
        text: "Secondary details in the sources reinforce the conclusion but leave some gaps.",
        status: "partially_supported",
        sources: [
          {
            path: f1,
            locator: "body",
            excerpt: "Supporting detail is present but is not exhaustive.",
          },
        ],
      });
    }
    claims.push({
      text: "This is the most important and definitive work in the entire field.",
      status: "unsupported",
      sources: [],
      reason:
        "No file in the selected context establishes field-wide ranking or comparative authority.",
      missingEvidence:
        "A peer-reviewed survey or citation analysis covering the broader field.",
      suggestedSourceType: "Academic survey or meta-analysis",
      conservativeRewrite: "This is a significant contribution within the field.",
    });

    return JSON.stringify({ claims });
  }

  // -- re-run diff -----------------------------------------------------------

  private diff(): string {
    return JSON.stringify({
      changedConclusions: [
        "The current run draws on a refreshed set of source files; the central thesis is unchanged but its supporting evidence is now broader.",
      ],
      summary:
        "This run reflects updates to the selected context. Core conclusions are stable, with incremental changes to evidence strength.",
    });
  }

  // -- chat ------------------------------------------------------------------

  /** A plausible conversational reply for the chat feature (no API key). */
  private chatReply(system: string, prompt: string): string {
    // The latest user turn is the last "User:" block in the rendered history.
    const turns = prompt.split(/^User:/m);
    const last = (turns[turns.length - 1] ?? prompt).trim().replace(/\s+/g, " ").slice(0, 240);

    const ctx = (system + "\n" + prompt).toLowerCase();
    const noted: string[] = [];
    if (/attached file|attachment|--- file/i.test(ctx)) noted.push("your attached file(s)");
    if (/search result/i.test(ctx)) noted.push("the web search results");
    if (/workspace (manifest|summary|files)/i.test(ctx)) noted.push("the connected workspace");

    const lines: string[] = [
      "This is a **mock reply** — no AI provider is configured, so Ariadne is echoing a placeholder. Pick a provider in Settings (or run Ollama locally) for real answers.",
      "",
    ];
    if (last) lines.push(`You said: _${last}_`, "");
    if (noted.length > 0) {
      lines.push(`I can see ${noted.join(", ")} in this conversation — a real provider would use that to answer.`, "");
    }
    lines.push("For source-backed, structured output, connect a workspace folder and run a Template.");
    return lines.join("\n");
  }

  // -- agent plan ------------------------------------------------------------

  private agentPlan(prompt: string): string {
    const lower = prompt.toLowerCase();
    const steps: Array<{ description: string; tool: string }> = [];

    if (/search|find|look up|web/i.test(lower)) {
      steps.push({ description: "Search the web for relevant information", tool: "web_search" });
    }
    if (/file|read|document|pdf/i.test(lower)) {
      steps.push({ description: "Read relevant files from the workspace", tool: "read_file" });
    }
    if (/image|photo|picture|chart/i.test(lower)) {
      steps.push({ description: "Analyze attached images or charts", tool: "analyze_image" });
    }
    if (/template|run|report|analysis/i.test(lower)) {
      steps.push({ description: "Run a research template for structured output", tool: "run_template" });
    }

    // Always add a reason step
    steps.push({ description: "Synthesise findings and formulate the answer", tool: "reason" });

    // Fallback: at least web_search + reason
    if (steps.length < 2) {
      steps.unshift({ description: "Research the topic", tool: "web_search" });
    }

    return JSON.stringify({ steps });
  }

  // -- brief -----------------------------------------------------------------

  private brief(system: string, prompt: string): string {
    const name = system.match(/structured "(.+?)" brief/i)?.[1] ?? "Brief";
    const sections = (system.match(/output contract sections:\s*(.+?)\./i)?.[1] ?? "summary, key_findings")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Source paths arrive as "## <path>" headers in the prompt; keep only
    // entries that look like file paths (have an extension).
    const paths = this.parseSourcePaths(prompt, /^## (.+)$/gm).filter((p) => /\.\w+$/.test(p));
    const topic = prompt.match(/"topic":\s*"(.+?)"/)?.[1];

    const lines: string[] = [`# ${name}`, ""];
    if (topic) lines.push(`_Topic: ${topic}_`, "");

    for (const section of sections) {
      lines.push(`## ${this.titleCase(section)}`);
      lines.push(this.sectionBody(section, paths));
      lines.push("");
    }
    return lines.join("\n");
  }

  private sectionBody(section: string, paths: string[]): string {
    const cite = paths[0] ?? "the selected sources";
    switch (section) {
      case "summary":
        return "This brief synthesises the approved source files into a structured, evidence-aware overview. It is a mock run — no AI provider is configured.";
      case "unsupported_claims":
        return '- "This is the most important work in the field" — no source establishes field-wide ranking.';
      case "missing_information":
        return "- Comparative benchmarks from outside the selected folder are absent.";
      case "next_actions":
        return "1. Review the unsupported claim and locate a corroborating source.\n2. Re-run the template once new files are added and compare the diff.";
      case "sources_used":
        return paths.length > 0 ? paths.map((p) => `- ${p}`).join("\n") : "- (no sources read)";
      default:
        return `Drawing on \`${cite}\`, the source material indicates a coherent body of evidence relevant to this section. Claims are mapped to sources in the Evidence tab.`;
    }
  }

  // -- helpers ---------------------------------------------------------------

  private parseSourcePaths(text: string, re: RegExp): string[] {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const captured = m[1];
      if (captured) out.push(captured.trim());
    }
    return out;
  }

  private titleCase(s: string): string {
    return s
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
