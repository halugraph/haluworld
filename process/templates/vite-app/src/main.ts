/**
 * App bootstrap — creates the shared app services, builds the ENTRY graph and starts it.
 *
 * The compiler agent edits exactly two things here:
 *   1. the `entry` import → the compiled graph's wiring module (src/graphs/<graph>.ts)
 *   2. the app `name` → the compiled graph's name (it namespaces localStorage keys)
 * Everything else stays as is.
 */
import './style.css';
import { createApp, type AppServices, type Graph } from './hlg-runtime.ts';
import entry from './graphs/examples/hello-button.ts'; // ← the compiled entry graph

declare global {
  interface Window {
    /** Debug handle for the browser console: `__hlg.graph.lastValue('slider1', 'value')`, `__hlg.app.state.snapshot()` … */
    __hlg?: { app: AppServices; graph: Graph };
  }
}

const app = createApp({ name: 'examples/hello-button', root: '#app' });

// Surface uncaught errors in the page (the artist watches the preview, not the console).
const onError = (event: ErrorEvent): void => app.reportError(event.error || event.message);
const onRejection = (event: PromiseRejectionEvent): void => app.reportError(event.reason);
window.addEventListener('error', onError);
window.addEventListener('unhandledrejection', onRejection);

const graph = entry({ app });
graph.start();

window.__hlg = { app, graph };

// Vite dev server: this module accepts hot updates, so editing a node module re-runs the bootstrap
// after tearing the old app down (no full page reload, no duplicated listeners or elements).
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    graph.dispose();
    app.dispose();
  });
}
