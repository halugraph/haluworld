/**
 * halugraph node  label1
 * type            ui/label
 * graph           examples/hello-button
 * action          Show how many times the button was clicked
 *
 * Ports: in text (wired from button1.clicked — every bang counts one click) · out element
 * Interpretation: the action turns the label into a counter, so incoming values are counted,
 * not displayed.
 */
import { h, type NodeContext, type NodeInstance } from '../../../hlg-runtime.ts';

type Inputs = { text: unknown };
type Outputs = { element: HTMLParagraphElement };

export default function node_label1(ctx: NodeContext<Outputs>): NodeInstance<Inputs> {
  let clicks = 0;
  const el = h('p', { class: 'hlg-label hlg-label--big', 'aria-live': 'polite' });

  const render = (): void => {
    el.textContent = clicks === 1 ? 'Clicked 1 time' : `Clicked ${clicks} times`;
  };
  render();
  ctx.emit('element', el);

  return {
    inputs: {
      text() {
        clicks += 1;
        render();
      },
    },
  };
}
