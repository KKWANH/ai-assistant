/**
 * TerminalPanel — a real workspace shell (P3 IDE #7), rendered with xterm.js and
 * bridged to the server PTY over a WebSocket. Lazy-loaded (xterm is heavy), so
 * the bundle only pays for it when the Terminal tab is opened.
 *
 * server → client: raw pty output; client → server: JSON input/resize.
 * The server gates this to LOCAL access only, so the tab is hidden for remote.
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useT } from "../../lib/i18n";

/** Read a "R G B" CSS custom property as a comma rgb() string xterm can parse. */
function cssRgb(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fallback;
    return `rgb(${v.split(/\s+/).join(", ")})`;
  } catch {
    return fallback;
  }
}

export function TerminalPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: cssRgb("--background", "rgb(13, 13, 13)"),
        foreground: cssRgb("--foreground", "rgb(230, 230, 230)"),
        cursor: cssRgb("--foreground", "rgb(230, 230, 230)"),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* host not measured yet */
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/workspaces/${workspaceId}/terminal`);

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      setClosed(false);
      sendResize();
      term.focus();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") term.write(e.data);
    };
    ws.onclose = () => setClosed(true);
    ws.onerror = () => setClosed(true);

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: d }));
    });

    // Keep the PTY's window size in sync with the panel.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* */
      }
      sendResize();
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      try {
        ws.close();
      } catch {
        /* */
      }
      term.dispose();
    };
  }, [workspaceId]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {closed && (
        <div className="shrink-0 px-3 py-1.5 text-2xs text-warning border-b border-border">
          {t("terminal.disconnected")}
        </div>
      )}
      <div ref={hostRef} className="flex-1 min-h-0 overflow-hidden px-2 pt-2" />
    </div>
  );
}
