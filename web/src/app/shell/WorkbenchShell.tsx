import { useEffect, useState, type ReactNode } from "react";
import { AppCommandPalette, type CommandPaletteItem } from "./AppCommandPalette";
import styles from "./WorkbenchShell.module.css";

export type WorkbenchShellProps = {
  topbar: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
  inspector?: ReactNode;
  overlays?: ReactNode;
  commandItems?: CommandPaletteItem[];
  sidebarOpen?: boolean;
  inspectorOpen?: boolean;
  onCloseSidebar?: () => void;
  commandOpen?: boolean;
  onCommandOpenChange?: (open: boolean) => void;
};

export function WorkbenchShell({
  topbar,
  sidebar,
  main,
  inspector,
  overlays,
  commandItems = [],
  sidebarOpen = true,
  inspectorOpen = false,
  onCloseSidebar,
  commandOpen,
  onCommandOpenChange,
}: WorkbenchShellProps) {
  const [localCommandOpen, setLocalCommandOpen] = useState(false);
  const paletteOpen = commandOpen ?? localCommandOpen;
  const setPaletteOpen = onCommandOpenChange ?? setLocalCommandOpen;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  const legacyLayoutClass = `layout ${inspectorOpen ? "with-workbench" : "no-workbench"} ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`;
  const layoutClass = [
    legacyLayoutClass,
    styles.layout,
    sidebarOpen ? "" : styles.sidebarClosed,
    inspectorOpen ? "" : styles.noInspector,
  ].filter(Boolean).join(" ");

  return (
    <div className={styles.shell}>
      {topbar}
      <main className={layoutClass}>
        {sidebar}
        {sidebarOpen && <button type="button" className={styles.scrim} aria-label="Close sidebar" onClick={onCloseSidebar} />}
        <section className={styles.main}>{main}</section>
        {inspector}
      </main>
      <AppCommandPalette open={paletteOpen} items={commandItems} onClose={() => setPaletteOpen(false)} />
      {overlays}
    </div>
  );
}
