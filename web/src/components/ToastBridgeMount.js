/**
 * WEB-P5 — runtime → toast bridge.
 *
 * Subscribes to the `runtime:request_failed` and `runtime:render_error`
 * window events that `runtime/index.ts` and `RootErrorBoundary` dispatch,
 * and surfaces a Toast.
 *
 * Mounted once at the top of the tree (rendered via ToastBridgeMount in
 * App.js). 401s are NOT toasted — the runtime auth-expired middleware
 * already handles them via redirect.
 *
 * Categories
 *  - 401 — silent (auth flow takes over)
 *  - 4xx — toast.warning
 *  - 5xx — toast.error
 *  - network/timeout — toast.error("Network error")
 *  - render error — toast.error("Page crashed — reloading…")
 */
import { useEffect, useRef } from 'react';
import { useToast } from './Toast';

const TOAST_THROTTLE_MS = 4000;

export default function ToastBridgeMount() {
  const { toast } = useToast();
  const lastShownAt = useRef({});

  useEffect(() => {
    const throttle = (key) => {
      const now = Date.now();
      const last = lastShownAt.current[key] || 0;
      if (now - last < TOAST_THROTTLE_MS) return false;
      lastShownAt.current[key] = now;
      return true;
    };

    const onRequestFailed = (ev) => {
      const detail = ev.detail || {};
      const status = Number(detail.status) || 0;
      const code = detail.code || 'unknown_error';
      const url = detail.url || '';

      if (status === 401 || code === 'session_expired') {
        return; // auth flow owns this
      }
      const throttleKey = `${status}:${code}:${url.split('?')[0]}`;
      if (!throttle(throttleKey)) return;

      const reqId = detail.request_id ? ` · ${String(detail.request_id).slice(0, 8)}` : '';
      if (status === 0) {
        toast.error('Network error', { description: `Could not reach server${reqId}` });
      } else if (status >= 500) {
        toast.error(`Server error (${status})`, {
          description: `${detail.message || code}${reqId}`,
        });
      } else if (status >= 400) {
        toast.warning(`Request rejected (${status})`, {
          description: `${detail.message || code}${reqId}`,
        });
      }
    };

    const onRenderError = (ev) => {
      const detail = ev.detail || {};
      if (!throttle('render-error')) return;
      toast.error('Page crashed', {
        description: detail.message || 'An unexpected error occurred. Reload the page.',
      });
    };

    window.addEventListener('runtime:request_failed', onRequestFailed);
    window.addEventListener('runtime:render_error', onRenderError);
    return () => {
      window.removeEventListener('runtime:request_failed', onRequestFailed);
      window.removeEventListener('runtime:render_error', onRenderError);
    };
  }, [toast]);

  return null;
}
