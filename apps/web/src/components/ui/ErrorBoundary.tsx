/**
 * ErrorBoundary — catches React render errors so a buggy view never
 * shows the user a blank black screen.
 *
 * Pre-AV the app had no boundary; the AT-fix TDZ crash showed up as
 * an empty <div id="root">. Now a friendly card with details + retry
 * appears, and the error is logged to console for triage.
 *
 * Use:
 *   - Wrap <App/> at the root for site-wide safety net
 *   - Wrap a single route (e.g. workspace surface) when you want the
 *     rest of the shell to keep working if just that view dies
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
  /** Optional friendly label shown above the error message. */
  label?: string;
  /** If supplied, this is rendered instead of the default card. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  err: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { err: null };

  static getDerivedStateFromError(err: Error): ErrorBoundaryState {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    // Surface to console for triage; don't swallow.
    console.error("[ErrorBoundary]", err, info.componentStack);
  }

  reset = (): void => {
    this.setState({ err: null });
  };

  override render(): ReactNode {
    const { err } = this.state;
    if (!err) return this.props.children;
    if (this.props.fallback) return this.props.fallback(err, this.reset);
    return (
      <div className="flex items-center justify-center min-h-[300px] w-full p-6">
        <div
          role="alert"
          className="max-w-md w-full p-5 rounded-xl border border-destructive/40 bg-card animate-fade-in-up"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 p-2 rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {this.props.label ?? "Something went wrong"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 break-words">
                {err.message || "Unknown error"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={this.reset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
            <button
              type="button"
              onClick={() => location.reload()}
              className="px-3 py-1.5 rounded-md border border-border bg-surface-2 text-foreground text-xs hover:bg-surface-3 transition-colors"
            >
              Reload page
            </button>
          </div>
          {err.stack && (
            <details className="mt-3">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                Stack trace
              </summary>
              <pre className="mt-2 text-2xs text-muted-foreground bg-surface-2 p-2 rounded max-h-48 overflow-auto whitespace-pre-wrap break-words">
                {err.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
