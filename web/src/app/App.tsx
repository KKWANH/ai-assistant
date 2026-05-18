import { AppShell } from "./shell/AppShell";
import LegacyApp from "./legacy/LegacyApp";

export function App() {
  return (
    <AppShell>
      <LegacyApp />
    </AppShell>
  );
}
