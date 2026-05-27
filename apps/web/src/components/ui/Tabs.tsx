import {
  createContext,
  useContext,
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
  return (
    <div
      role="tablist"
      className={[styles["list"]!, className].filter(Boolean).join(" ")}
    >
      {children}
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
  return (
    <button
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
