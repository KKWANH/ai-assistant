/**
 * RegisteredSettings — renders every settings section contributed through the
 * settings registry. The Settings view drops this in below its built-in
 * sections, so a feature's preferences appear without SettingsView knowing
 * about them. Toggle + select fields, themed to match the rest of Settings.
 */
import { useRegisteredSettings, type SettingsField } from "../../lib/settings-registry";

function FieldRow({ field }: { field: SettingsField }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-foreground">{field.label}</div>
        {field.description && <div className="mt-0.5 text-xs text-muted-foreground">{field.description}</div>}
      </div>
      {field.type === "toggle" ? (
        <button
          type="button"
          role="switch"
          aria-checked={field.value}
          aria-label={field.label}
          onClick={() => field.onChange(!field.value)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${field.value ? "bg-accent" : "bg-surface-3"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${field.value ? "translate-x-[18px]" : "translate-x-0.5"}`}
          />
        </button>
      ) : (
        <select
          value={field.value}
          aria-label={field.label}
          onChange={(e) => field.onChange(e.target.value)}
          className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function RegisteredSettings() {
  const sections = useRegisteredSettings();
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map(({ id, section }) => (
        <section key={id}>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
            {section.title}
          </h2>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {section.fields.map((f) => (
              <FieldRow key={f.id} field={f} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
