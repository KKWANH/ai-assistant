import { useEffect, useState, type ReactNode } from "react";
import { AppCommandPalette, type CommandPaletteItem } from "./AppCommandPalette";

type AppShellProps = {
  children?: ReactNode;
  topbar?: ReactNode;
  sidebar?: ReactNode;
  main?: ReactNode;
  inspector?: ReactNode;
  overlays?: ReactNode;
  commandItems?: CommandPaletteItem[];
  sidebarOpen?: boolean;
  inspectorOpen?: boolean;
  onCloseSidebar?: () => void;
  commandOpen?: boolean;
  onCommandOpenChange?: (open: boolean) => void;
};

export function AppShell({
  children,
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
}: AppShellProps) {
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

  if (children && !topbar && !sidebar && !main && !inspector && !overlays) return <>{children}</>;
  return (
    <div className="app-shell">
      {topbar}
      <main className={`layout ${inspectorOpen ? "with-workbench" : "no-workbench"} ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
        {sidebar}
        {sidebarOpen && <button type="button" className="mobile-sidebar-scrim" aria-label="Close sidebar" onClick={onCloseSidebar} />}
        {main}
        {inspector}
      </main>
      <AppCommandPalette open={paletteOpen} items={commandItems} onClose={() => setPaletteOpen(false)} />
      {overlays}
    </div>
  );
}
