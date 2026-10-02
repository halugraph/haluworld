/**
 * halugraph node  app
 * type            output
 * graph           examples/hello-button
 * action          A tiny page titled “Hello button”: the button and the click counter, centred on a dark background
 *
 * Ports: in content (elements, fan-in in wire order), title (text), style (CSS text, or theme
 *        variables { accent: '#f0a' } → --hlg-accent on the page root)
 * The output node builds the page: it owns the root layout and mounts it into #app on start().
 */
import { h, type NodeContext, type NodeInstance } from '../../../hlg-runtime.ts';

type Inputs = { content: unknown; title: unknown; style: unknown };

export default function node_app(ctx: NodeContext): NodeInstance<Inputs> {
  const root = h('main', { class: 'hlg-output hlg-output--centered' });
  const slots: Array<Node | null> = []; // content by wire slot, so the page order follows the graph's wire order
  const styleEl = h('style', { 'data-hlg-style': ctx.id });
  const themeVars = new Set<string>(); // CSS variables this node set on <html>, removed on dispose
  let unmount: (() => void) | null = null;

  const toNode = (value: unknown): Node | null => {
    if (value && typeof value === 'object' && 'nodeType' in value) return value as Node;
    if (value === null || value === undefined) return null;
    return h('p', { class: 'hlg-text' }, String(value));
  };
  const render = (): void => root.replaceChildren(...slots.filter((n): n is Node => Boolean(n)));

  document.title = 'Hello button';

  return {
    inputs: {
      content(value, info) {
        const slot = info && info.slot >= 0 ? info.slot : slots.length;
        slots[slot] = toNode(value);
        render();
      },
      title(value) {
        document.title = String(value ?? '');
      },
      style(value) {
        if (typeof value === 'string') styleEl.textContent = value;
        else if (value && typeof value === 'object') {
          // Theme variables of style.css: { accent } → --hlg-accent; explicit "--name" keys stay as they are.
          // Set on <html> so the body background, overlays and banners follow the theme too.
          for (const [k, v] of Object.entries(value)) {
            const name = k.startsWith('--') ? k : `--hlg-${k}`;
            document.documentElement.style.setProperty(name, String(v));
            themeVars.add(name);
          }
        }
      },
    },
    start() {
      document.head.appendChild(styleEl);
      unmount = ctx.app.mount(root);
    },
    dispose() {
      if (unmount) unmount();
      styleEl.remove();
      for (const name of themeVars) document.documentElement.style.removeProperty(name);
    },
  };
}
