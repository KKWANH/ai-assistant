/**
 * Surface host routes — registered OUTSIDE /api (no authentication required).
 *
 * These endpoints serve the sandboxed iframe shell that renders the user's compiled surface.
 * Because the iframe is sandboxed with `sandbox="allow-scripts"` (no allow-same-origin),
 * it cannot access the parent's cookies or DOM.  Data access flows through the postMessage SDK.
 *
 * GET /surface/:workspaceId/host?theme=dark|light  → HTML host document
 * GET /surface/:workspaceId/bundle.js              → compiled IIFE bundle
 */

import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { themeTokensToCss } from "@ariadne/shared";
import type { ThemeMode } from "@ariadne/shared";
import { dbGetWorkspace } from "../db/repo.js";
import { surfaceBundlePath } from "../ariadneFolder.js";

export async function surfaceHostRoutes(app: FastifyInstance): Promise<void> {
  // GET /surface/:workspaceId/host
  app.get<{ Params: { workspaceId: string }; Querystring: { theme?: string } }>(
    "/surface/:workspaceId/host",
    async (req, reply) => {
      const workspace = dbGetWorkspace(req.params.workspaceId);
      if (!workspace) {
        return reply.status(404).type("text/html").send("<h1>Workspace not found</h1>");
      }

      const rawTheme = req.query.theme;
      const theme: ThemeMode = rawTheme === "light" ? "light" : "dark";
      const tokensCss = themeTokensToCss(theme);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ariadne Surface</title>
  <style>
    :root { ${tokensCss} }
    *, *::before, *::after { box-sizing: border-box; }
    /* Let the browser render native UI (scrollbars, controls) for this theme. */
    html { color-scheme: ${theme}; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: system-ui, sans-serif;
      background: rgb(var(--background));
      color: rgb(var(--foreground));
    }
    #surface-root { padding: 0; }
    /* Themed scrollbars — match the main app, no default light bars. */
    * { scrollbar-width: thin; scrollbar-color: rgb(var(--border-strong)) transparent; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: rgb(var(--border-strong));
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgb(var(--muted-foreground)); }
  </style>
</head>
<body>
  <div id="surface-root"></div>
  <script>
    /**
     * Expose the injected theme mode as window.__ariadneTheme so that
     * any surface (including those that don't use useAriadne()) can read it.
     * Colours come from CSS custom properties, not from this object.
     */
    window.__ariadneTheme = ${JSON.stringify({ mode: theme })};

    /**
     * Ariadne Surface SDK bootstrap.
     *
     * Exposes window.ariadne with methods that bridge to the parent frame
     * via the postMessage protocol:
     *
     *   iframe → parent: { source: "ariadne-surface", reqId, method, args }
     *   parent → iframe: { source: "ariadne-host", reqId, ok, result?, error? }
     *
     * Available methods:
     *   listFiles()
     *   readText(path)
     *   readCsv(path)   → { headers, rows }
     *   listTemplates()
     *   listRuns()
     *   runTemplate(id, input)
     *   stageFile(path, content)     → { runId, added, removed }
     *   getRun(runId)
     *   getQuotes(symbols)          → Array<{ symbol, price, currency }>
     *   getFxRates(base, currencies) → Record<currency, rate>
     *   getTheme()      → { mode }  (colours come from CSS vars)
     */
    (function () {
      let _counter = 0;
      function call(method, args) {
        return new Promise(function (resolve, reject) {
          var reqId = 'req-' + Date.now().toString(36) + '-' + (++_counter).toString(36);
          function handler(event) {
            var d = event.data;
            if (!d || d.source !== 'ariadne-host' || d.reqId !== reqId) return;
            window.removeEventListener('message', handler);
            if (d.ok) resolve(d.result);
            else reject(new Error(d.error || 'Unknown host error'));
          }
          window.addEventListener('message', handler);
          window.parent.postMessage({ source: 'ariadne-surface', reqId: reqId, method: method, args: args }, '*');
        });
      }
      window.ariadne = {
        listFiles: function () { return call('listFiles', []); },
        readText: function (p) { return call('readText', [p]); },
        readCsv: function (p) { return call('readCsv', [p]); },
        listTemplates: function () { return call('listTemplates', []); },
        listRuns: function () { return call('listRuns', []); },
        runTemplate: function (id, input) { return call('runTemplate', [id, input]); },
        stageFile: function (p, content) { return call('stageFile', [p, content]); },
        getRun: function (id) { return call('getRun', [id]); },
        getQuotes: function (symbols) { return call('getQuotes', [symbols]); },
        getFxRates: function (base, currencies) { return call('getFxRates', [base, currencies]); },
        getTheme: function () { return Promise.resolve(window.__ariadneTheme); },
      };
    })();
  </script>
  <script src="./bundle.js"></script>
</body>
</html>`;

      // The host embeds live theme tokens and references a mutable bundle —
      // never cache it, or edits/rebuilds won't show up.
      return reply.type("text/html").header("Cache-Control", "no-store").send(html);
    }
  );

  // GET /surface/:workspaceId/bundle.js
  app.get<{ Params: { workspaceId: string } }>(
    "/surface/:workspaceId/bundle.js",
    async (req, reply) => {
      const workspace = dbGetWorkspace(req.params.workspaceId);
      if (!workspace) {
        return reply
          .status(404)
          .type("application/javascript")
          .send("// Workspace not found");
      }

      const bundlePath = surfaceBundlePath(workspace.rootPath);
      if (!fs.existsSync(bundlePath)) {
        return reply
          .status(404)
          .type("application/javascript")
          .header("Cache-Control", "no-store")
          .send(`// Bundle not built yet. POST /api/workspaces/${req.params.workspaceId}/surface/build to compile.`);
      }

      // The bundle is rebuilt in place at a stable URL — never cache it.
      const js = fs.readFileSync(bundlePath, "utf-8");
      return reply.type("application/javascript").header("Cache-Control", "no-store").send(js);
    }
  );
}
