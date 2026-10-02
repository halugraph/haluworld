/**
 * halugraph node  button1
 * type            ui/button
 * graph           examples/hello-button
 * action          A big friendly “Click me” button
 *
 * Ports: in label (text), enabled (bool) · out element (HTMLButtonElement), clicked (bang), pressed (bool)
 */
import { h, type Bang, type NodeContext, type NodeInstance } from '../../../hlg-runtime.ts';

/** Input ports. Wires are not type-checked at run time, so inputs arrive as `unknown` and are coerced. */
type Inputs = { label: unknown; enabled: unknown };
/** Output ports and what they carry (checked by `ctx.emit` / `ctx.bang`). */
type Outputs = { element: HTMLButtonElement; clicked: Bang; pressed: boolean };

export default function node_button1(ctx: NodeContext<Outputs>): NodeInstance<Inputs> {
  const el = h('button', { class: 'hlg-button hlg-button--primary hlg-button--big', type: 'button' }, 'Click me');

  const setPressed = (down: boolean): void => {
    if (ctx.lastValue('pressed') !== down) ctx.emit('pressed', down);
  };
  ctx.listen(el, 'click', () => ctx.bang('clicked'));
  ctx.listen(el, 'pointerdown', () => setPressed(true));
  ctx.listen(el, 'pointerup', () => setPressed(false));
  ctx.listen(el, 'pointerleave', () => setPressed(false));
  ctx.listen(el, 'pointercancel', () => setPressed(false));

  ctx.emit('pressed', false);
  ctx.emit('element', el);

  return {
    inputs: {
      label(value) {
        el.textContent = String(value ?? '');
      },
      enabled(value) {
        el.disabled = value === false || value === 0 || value === 'false';
      },
    },
  };
}
