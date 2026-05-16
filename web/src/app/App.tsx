import { AppShell } from "./layout/AppShell";
import LegacyApp from "./legacy/LegacyApp";

export function App() {
  return (
    <AppShell>
      <LegacyApp />
    </AppShell>
  );
}
