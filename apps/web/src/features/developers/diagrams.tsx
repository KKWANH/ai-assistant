/**
 * Architecture diagrams for the developer docs — hand-authored SVG, themed via
 * CSS vars so they track light/dark. A tiny Node/Edge DSL keeps them legible.
 */
import type { ReactNode } from "react";

const FG = "rgb(var(--foreground))";
const MUTED = "rgb(var(--muted-foreground))";
const BORDER = "rgb(var(--border))";
const ACCENT = "rgb(var(--accent))";

function Node({
  x,
  y,
  w,
  h,
  title,
  sub,
  accent,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={accent ? "rgb(var(--accent) / 0.12)" : "rgb(var(--surface-2))"}
        stroke={accent ? ACCENT : BORDER}
        strokeWidth={1}
      />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 4 : h / 2 + 4)} textAnchor="middle" fill={FG} fontSize={12} fontWeight={600}>
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fill={MUTED} fontSize={9.5}>
          {sub}
        </text>
      )}
    </g>
  );
}

/** Straight arrow from (x1,y1) to (x2,y2) with an optional centered label. */
function Edge({
  x1,
  y1,
  x2,
  y2,
  label,
  dashed,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  dashed?: boolean;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={MUTED}
        strokeWidth={1.25}
        strokeDasharray={dashed ? "4 3" : undefined}
        markerEnd="url(#arrow)"
      />
      {label && (
        <text x={mx} y={my - 4} textAnchor="middle" fill={MUTED} fontSize={9} fontStyle="italic">
          <tspan dx={0} dy={0} style={{ paintOrder: "stroke" }}>
            {label}
          </tspan>
        </text>
      )}
    </g>
  );
}

function Frame({ viewBox, children }: { viewBox: string; children: ReactNode }) {
  return (
    <svg viewBox={viewBox} className="w-full h-auto" role="img">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={MUTED} />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

/** System architecture — browser ↔ server ↔ storage/providers + the channels. */
export function SystemDiagram() {
  return (
    <Frame viewBox="0 0 760 430">
      {/* Browser lane */}
      <rect x={10} y={10} width={740} height={120} rx={10} fill="none" stroke={BORDER} strokeDasharray="3 3" />
      <text x={22} y={28} fill={MUTED} fontSize={10} fontWeight={700}>BROWSER — React 18 + Vite</text>
      <Node x={30} y={40} w={180} h={72} title="App shell" sub="routes · registries · IDE" accent />
      <Node x={240} y={40} w={170} h={72} title="Surface iframe" sub="sandboxed user UI" />
      <Node x={440} y={40} w={140} h={72} title="xterm.js" sub="terminal" />
      <Node x={600} y={40} w={140} h={72} title="TanStack Query" sub="server state" />

      {/* Server lane */}
      <rect x={10} y={200} width={740} height={110} rx={10} fill="none" stroke={BORDER} strokeDasharray="3 3" />
      <text x={22} y={218} fill={MUTED} fontSize={10} fontWeight={700}>SERVER — Fastify (node, tsx)</text>
      <Node x={30} y={230} w={150} h={68} title="Routes" sub="31 domains · /api" accent />
      <Node x={205} y={230} w={150} h={68} title="Services" sub="retrieval · runs · git · pty" />
      <Node x={380} y={230} w={150} h={68} title="Surface host" sub="esbuild bundle" />
      <Node x={560} y={230} w={170} h={68} title="Auth hook" sub="local=admin · remote=cookie" />

      {/* Storage / providers lane */}
      <rect x={10} y={360} width={740} height={62} rx={10} fill="none" stroke={BORDER} strokeDasharray="3 3" />
      <Node x={30} y={372} w={150} h={40} title="node:sqlite" />
      <Node x={205} y={372} w={150} h={40} title="Embedding index" />
      <Node x={380} y={372} w={150} h={40} title="AI providers" />
      <Node x={560} y={372} w={170} h={40} title="Host git · PTY · fs" />

      {/* Channels */}
      <Edge x1={120} y1={112} x2={105} y2={230} label="HTTP / SSE" />
      <Edge x1={325} y1={112} x2={420} y2={230} label="postMessage" dashed />
      <Edge x1={510} y1={112} x2={510} y2={230} label="WebSocket" />
      <Edge x1={690} y1={112} x2={650} y2={230} label="REST" />
      <Edge x1={105} y1={298} x2={105} y2={372} />
      <Edge x1={280} y1={298} x2={280} y2={372} />
      <Edge x1={455} y1={298} x2={455} y2={372} />
      <Edge x1={645} y1={298} x2={645} y2={372} />
    </Frame>
  );
}

/** A chat message's lifecycle through the send pipeline. */
export function RequestLifecycleDiagram() {
  const row = (y: number) => y;
  return (
    <Frame viewBox="0 0 760 360">
      <Node x={20} y={row(20)} w={150} h={50} title="Composer" sub="POST /chats/:id/messages" accent />
      <Node x={220} y={row(20)} w={150} h={50} title="streamAssistantReply" sub="SSE channel open" />
      <Node x={430} y={row(20)} w={170} h={50} title="resolve settings" sub="workspace override ?? global" accent />

      <Node x={430} y={row(120)} w={170} h={50} title="triage" sub="cheap tier classifier" />
      <Node x={220} y={row(120)} w={150} h={50} title="retrieval (RAG)" sub="top-k chunks" />
      <Node x={20} y={row(120)} w={150} h={50} title="provider call" sub="metered tokens" accent />

      <Node x={20} y={row(220)} w={150} h={50} title="SSE deltas" sub="stream to client" />
      <Node x={220} y={row(220)} w={150} h={50} title="persist" sub="message + usage → sqlite" />
      <Node x={430} y={row(220)} w={170} h={50} title="title + memory" sub="async, non-blocking" />

      <Edge x1={170} y1={45} x2={220} y2={45} />
      <Edge x1={370} y1={45} x2={430} y2={45} />
      <Edge x1={515} y1={70} x2={515} y2={120} />
      <Edge x1={430} y1={145} x2={370} y2={145} />
      <Edge x1={220} y1={145} x2={170} y2={145} />
      <Edge x1={95} y1={170} x2={95} y2={220} />
      <Edge x1={170} y1={245} x2={220} y2={245} />
      <Edge x1={370} y1={245} x2={430} y2={245} />
      <text x={620} y={250} fill={MUTED} fontSize={9} fontStyle="italic">instant mode skips</text>
      <text x={620} y={262} fill={MUTED} fontSize={9} fontStyle="italic">triage + retrieval</text>
    </Frame>
  );
}

/** Workspace-centric data model. */
export function DataModelDiagram() {
  return (
    <Frame viewBox="0 0 760 360">
      <Node x={300} y={150} w={160} h={60} title="Workspace" sub="rootPath · globs · model" accent />

      <Node x={300} y={20} w={160} h={48} title="Snapshot" sub="files: FileMeta[]" />
      <Node x={560} y={60} w={170} h={48} title="Chats → Messages" sub="provider · model · usage" />
      <Node x={560} y={150} w={170} h={48} title="Runs → Claims" sub="brief · evidence · diff" />
      <Node x={560} y={240} w={170} h={48} title="Surface" sub=".ariadne/surface.tsx" />
      <Node x={300} y={290} w={160} h={48} title="Memory · Skills" sub="injected context" />
      <Node x={30} y={150} w={170} h={48} title="Embedding index" sub="chunks → vectors" />

      <Edge x1={380} y1={150} x2={380} y2={68} label="scan" />
      <Edge x1={460} y1={170} x2={560} y2={150} label="1·N" />
      <Edge x1={460} y1={180} x2={560} y2={84} label="1·N" />
      <Edge x1={460} y1={195} x2={560} y2={250} label="0·1" />
      <Edge x1={380} y1={210} x2={380} y2={290} />
      <Edge x1={300} y1={180} x2={200} y2={174} label="index" />
    </Frame>
  );
}
