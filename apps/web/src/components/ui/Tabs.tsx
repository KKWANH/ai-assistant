import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./Tabs.module.css";

interface TabsContext {
  value: string;
  onChange: (v: string) => void;
}

const Ctx = createContext<TabsContext>({ value: "", onChange: () => {} });

export interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({
  defaultValue = "",
  value: controlled,
  onValueChange,
  children,
  className = "",
}: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled !== undefined ? controlled : internal;
  const onChange = (v: string) => {
    setInternal(v);
    onValueChange?.(v);
  };
  return (
    <Ctx.Provider value={{ value, onChange }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Scroll-shadow: the tab row scrolls horizontally with a hidden scrollbar, so
  // without an edge cue overflowing tabs (e.g. the workspace's power tabs) are
  // invisible. Fade the side(s) that have more tabs to scroll to.
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update); // tabs added/removed (Advanced toggle)
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return (
    <div className="relative">
      <div
        ref={ref}
        role="tablist"
        className={[styles["list"]!, className].filter(Boolean).join(" ")}
      >
        {children}
      </div>
      {edges.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
      )}
      {edges.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
      )}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className = "",
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  const active = ctx.value === value;
  const ref = useRef<HTMLButtonElement>(null);
  // Keep the selected tab visible when the row overflows (e.g. selecting Git or
  // Terminal at the far right scrolls them into view) — but only when it's
  // actually clipped, so a near-start active tab doesn't needlessly scroll the
  // row on load.
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const list = el?.closest<HTMLElement>('[role="tablist"]');
    if (!el || !list) return;
    const er = el.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    if (er.left < lr.left || er.right > lr.right) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [active]);
  return (
    <button
      ref={ref}
      role="tab"
      aria-selected={active}
      onClick={() => ctx.onChange(value)}
      className={[
        styles["trigger"]!,
        active ? styles["triggerActive"]! : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className = "",
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  if (ctx.value !== value) return null;
  // AV polish: subtle fade-in when the panel mounts (or remounts on tab
  // switch). `key={value}` forces React to remount and replay the
  // animation each time the user changes tabs.
  return (
    <div
      role="tabpanel"
      key={value}
      className={`animate-fade-in ${className}`}
    >
      {children}
    </div>
  );
}
