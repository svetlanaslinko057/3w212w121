/**
 * WEB-P5 — RootErrorBoundary
 *
 * Catches uncaught render errors anywhere in the React tree below.
 * Surfaces a HonestState-shaped error UI and logs the error to console
 * (where existing telemetry can pick it up).
 *
 * Wraps the AppRouter beneath AuthProvider so that auth context is
 * available, and beneath ToastProvider so the boundary can also
 * surface a toast on mount.
 */
import { Component } from 'react';
import { WifiOff, RotateCcw } from 'lucide-react';

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[web-p5] uncaught render error', { error, info });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('runtime:render_error', {
          detail: { message: error?.message || String(error), stack: error?.stack || '' },
        })
      );
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center bg-[var(--t-bg)] text-white p-6"
          data-testid="root-error-boundary"
        >
          <div className="max-w-md w-full p-8 rounded-2xl border border-border bg-[var(--t-surface-raised)]">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <WifiOff className="w-7 h-7 text-red-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-1">Something went wrong</h2>
                <p className="text-sm text-muted-foreground">
                  The page crashed unexpectedly. The error has been logged.
                </p>
                {this.state.error?.message && (
                  <p className="mt-3 text-xs font-mono text-muted-foreground bg-muted/40 rounded-lg p-2 break-words">
                    {this.state.error.message}
                  </p>
                )}
              </div>
              <button
                onClick={this.handleRetry}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-signal/15 border border-signal/30 text-signal text-sm font-medium hover:bg-signal/25 transition"
                data-testid="root-error-retry"
              >
                <RotateCcw className="w-4 h-4" />
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default RootErrorBoundary;
