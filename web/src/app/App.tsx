import { AppShell } from "./layout/AppShell";
import LegacyApp from "./legacy/LegacyApp.jsx";

export function App() {
  return (
    <AppShell>
      <LegacyApp />
    </AppShell>
  );
}
