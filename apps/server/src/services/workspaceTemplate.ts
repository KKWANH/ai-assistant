/**
 * BL — workspace templates (federated marketplace, no central server).
 *
 * A workspace can be exported as a portable `.ariadne.tar`: a manifest
 * (`template.yaml`) + the surface source + actions + any seed files the AUTHOR
 * explicitly lists. The archive is shared as a file or a Git repo and imported
 * on the other side (BL2). Trust posture (BL3): the importer reviews the
 * manifest + consents before anything is written or built.
 *
 * Privacy default: a workspace's data files are the user's personal content,
 * so export includes NONE of them unless the author opts in via
 * `template.yaml` `seedFiles`. Without a template.yaml we ship only the app
 * structure (surface + actions) + a generated manifest.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as tar from "tar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Keep in sync with API_VERSION in surface/runtime.tsx (that module is
 *  browser-only — pulls in React/window — so it can't be imported here). */
const SURFACE_API_VERSION = 1;

/** The manifest carried at the root of an exported template. */
export interface TemplateManifest {
  /** Manifest format version (this file's schema), not the surface's. */
  ariadneTemplate: number;
  name: string;
  version: string;
  author?: string;
  description?: string;
  category?: string;
  tags?: string[];
  /** Surface entry, relative to workspace root. */
  surface?: string;
  /** Actions file, relative to workspace root. */
  actions?: string;
  /** Data files to seed on import — AUTHOR-curated. Empty by default so no
   *  personal data leaves the machine. Paths are workspace-root-relative. */
  seedFiles: string[];
  /** SDK API version the surface targets (BJ6). */
  surfaceRuntimeVersion: number;
}

const TEMPLATE_YAML = ".ariadne/template.yaml";
const SURFACE_SINGLE = ".ariadne/surface.tsx";
const SURFACE_FOLDER = ".ariadne/surface";
const ACTIONS_YAML = ".ariadne/actions.yaml";

/**
 * Build the manifest for a workspace: use a committed `.ariadne/template.yaml`
 * if the author wrote one (their curation wins), else generate a minimal,
 * privacy-safe one (app structure only, no seed data).
 */
export function buildTemplateManifest(workspaceRoot: string, workspaceName: string): TemplateManifest {
  const existing = path.join(workspaceRoot, TEMPLATE_YAML);
  if (fs.existsSync(existing)) {
    const parsed = (parseYaml(fs.readFileSync(existing, "utf-8")) ?? {}) as Partial<TemplateManifest>;
    return {
      ariadneTemplate: 1,
      name: parsed.name ?? workspaceName,
      version: parsed.version ?? "1.0.0",
      author: parsed.author,
      description: parsed.description,
      category: parsed.category,
      tags: parsed.tags ?? [],
      surface: parsed.surface ?? detectSurface(workspaceRoot),
      actions: parsed.actions ?? detectActions(workspaceRoot),
      seedFiles: Array.isArray(parsed.seedFiles) ? parsed.seedFiles : [],
      surfaceRuntimeVersion: parsed.surfaceRuntimeVersion ?? SURFACE_API_VERSION,
    };
  }
  return {
    ariadneTemplate: 1,
    name: workspaceName,
    version: "1.0.0",
    tags: [],
    surface: detectSurface(workspaceRoot),
    actions: detectActions(workspaceRoot),
    seedFiles: [],
    surfaceRuntimeVersion: SURFACE_API_VERSION,
  };
}

function detectSurface(workspaceRoot: string): string | undefined {
  if (fs.existsSync(path.join(workspaceRoot, SURFACE_FOLDER, "index.tsx"))) return SURFACE_FOLDER;
  if (fs.existsSync(path.join(workspaceRoot, SURFACE_SINGLE))) return SURFACE_SINGLE;
  return undefined;
}

function detectActions(workspaceRoot: string): string | undefined {
  return fs.existsSync(path.join(workspaceRoot, ACTIONS_YAML)) ? ACTIONS_YAML : undefined;
}

/**
 * Export a workspace as a `.ariadne.tar` buffer. Stages the manifest + the
 * included files in a temp dir (so a freshly-generated manifest tars cleanly,
 * with no side effects on the workspace) and archives it.
 */
export async function exportWorkspaceTemplate(
  workspaceRoot: string,
  workspaceName: string,
): Promise<{ manifest: TemplateManifest; tar: Buffer }> {
  const manifest = buildTemplateManifest(workspaceRoot, workspaceName);

  // Collect the workspace-relative paths to include.
  const rels = new Set<string>();
  if (manifest.surface) {
    if (manifest.surface === SURFACE_FOLDER) {
      for (const f of walk(path.join(workspaceRoot, SURFACE_FOLDER))) {
        rels.add(path.join(SURFACE_FOLDER, f));
      }
    } else {
      rels.add(manifest.surface);
    }
  }
  if (manifest.actions) rels.add(manifest.actions);
  for (const sf of manifest.seedFiles) {
    // Guard: seed paths must resolve inside the workspace (no `../` escape).
    const abs = path.resolve(workspaceRoot, sf);
    if (!abs.startsWith(path.resolve(workspaceRoot) + path.sep)) continue;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) rels.add(sf);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "ariadne-export-"));
  const tarFile = `${staging}.tar`;
  try {
    // Manifest at the archive root.
    fs.writeFileSync(path.join(staging, "template.yaml"), stringifyYaml(manifest), "utf-8");
    // Copy each included file, preserving its relative path.
    for (const rel of rels) {
      const src = path.join(workspaceRoot, rel);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(staging, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    const entries = ["template.yaml", ...rels];
    await tar.create({ cwd: staging, file: tarFile, gzip: false }, entries);
    return { manifest, tar: fs.readFileSync(tarFile) };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(tarFile, { force: true });
  }
}

/** Shallow recursive file walk → workspace-relative paths under `dir`. */
function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}
