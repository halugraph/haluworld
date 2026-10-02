/**
 * halugraph graph  examples/hello-button
 * source           graphs/examples/hello-button.yml
 * description      The tutorial's end state: a button and a label that counts the clicks.
 *
 * REFERENCE COMPILE shipped with the vite-app template. It shows the conventions every compile
 * follows (one module per node, this wiring file, node ids as-is). process/compile.md copies the
 * template WITHOUT src/graphs/ and src/nodes/, so this example never ends up in another compile.
 *
 * Nodes without a module: `about` (comment — ignored by the compiler).
 */
import { createGraph, type Graph, type GraphDeps } from '../../hlg-runtime.ts';
import node_button1 from '../../nodes/examples/hello-button/button1.ts';
import node_label1 from '../../nodes/examples/hello-button/label1.ts';
import node_app from '../../nodes/examples/hello-button/app.ts';

/** Graph factory: `({ app }) => graph`. Usable as the entry graph or as a subgraph node. */
export default function graph_examples_hello_button({ app }: GraphDeps): Graph {
  const g = createGraph({ app, name: 'examples/hello-button' });

  g.add('button1', node_button1, { type: 'ui/button', action: 'A big friendly “Click me” button' });
  g.add('label1', node_label1, { type: 'ui/label', action: 'Show how many times the button was clicked' });
  g.add('app', node_app, {
    type: 'output',
    action: 'A tiny page titled “Hello button”: the button and the click counter, centred on a dark background',
  });

  // Wires, in the order of the YAML connection lists (fan-in order matters for output.content).
  g.connect('button1', 'clicked', 'label1', 'text');
  g.connect('button1', 'element', 'app', 'content');
  g.connect('label1', 'element', 'app', 'content');

  return g;
}
