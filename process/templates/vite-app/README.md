# vite-app — starting point for every generated app (Vite + TypeScript)

`process/compile.md` copies this folder into `agents/compiles/<id>/app/` (without `src/graphs/` and
`src/nodes/`) and the agent adds one TypeScript module per graph node plus a wiring file per graph.

```
index.html            the hlg-js script first (no flicker), the static hlg-seo header (one <h1>), <div id="app">, loads src/main.ts
vite.config.ts        base './' (the app works under /preview/<id>/); no imports needed
tsconfig.json         strict type check of src/ (noEmit, verbatimModuleSyntax, .ts import extensions)
package.json          private ESM package; scripts dev / typecheck / build; list extra libraries under "dependencies"
src/main.ts           bootstrap: createApp → entry graph → graph.start()
src/hlg-runtime.ts    the typed dataflow runtime (copy verbatim, never edit inside a compile)
src/vite-env.d.ts     Vite's client types (import.meta.hot, CSS and asset imports)
src/style.css         default look: dark/light, responsive, hlg-* classes
src/graphs/examples/hello-button.ts          reference compile: wiring of graphs/examples/hello-button.yml
src/nodes/examples/hello-button/*.ts         reference compile: one module per node
```

The reference compile is a complete, working example of the conventions — read it before generating
code. It is excluded when the template is copied.

The toolchain (Vite + TypeScript) lives in `agents/compiles/node_modules` (shared by every compile).
Commands, run from the project root (`process/compile.md` Steps 8–9):

```bash
node agents/compiles/node_modules/typescript/bin/tsc --noEmit -p agents/compiles/<id>/app
node agents/compiles/node_modules/vite/bin/vite.js build agents/compiles/<id>/app --outDir ../../build/<id> --emptyOutDir --base ./
```

Vite does not check types; `tsc` does (no output = no errors). A dev server for experiments (hot
reload re-runs `main.ts`; it keeps running, so start it in the background and stop it when done):
`node agents/compiles/node_modules/vite/bin/vite.js agents/compiles/<id>/app`.

## Link previews and search engines

`index.html` carries what link previews and search engines read (the App node, `nodes/output.yaml`): the
sharing tags in `<head>`, and the page's one `<h1>` and description in a static `<header class="hlg-seo">`
before `<div id="app">`. That header is hidden from the first frame while the app runs — no flicker — by two
pieces. An app seeded from before them lacks both: add them as they are here.

The first script of `index.html`, right after `<meta charset="UTF-8" />`:

```html
<script>document.documentElement.classList.add('hlg-js')</script>
```

The rule in `src/style.css` (visually hidden, never `display: none`: crawlers and screen readers keep it):

```css
.hlg-js .hlg-seo {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

---

## Runtime API (`src/hlg-runtime.ts`)

Import values and types from the runtime with the `.ts` extension; types need the `type` modifier:

```ts
// in src/nodes/examples/synth/osc.ts (one ../ per folder of nodes/<graph>/)
import { h, toNumber, type Bang, type NodeContext, type NodeInstance } from '../../../hlg-runtime.ts';
```

### Nodes

A node module default-exports a **factory** (`NodeFactory`) that is called once per node instance.
Describe the node's ports with two object types: `Inputs` (every value `unknown` — wires are not
checked at run time, so coerce) and `Outputs` (what each output carries). `NodeContext<Outputs>`
then type-checks every `ctx.emit` / `ctx.bang`, and `NodeInstance<Inputs>` types the handlers. The
factory must be synchronous (the type check rejects an `async` factory; at run time it is reported as
an error); `start()` and input handlers may be `async` — a rejected promise is reported with the node id:

```ts
// src/nodes/main/slider1.ts — node slider1 of graph main
import { h, type NodeContext, type NodeInstance } from '../../hlg-runtime.ts';

type Inputs = { min: unknown; max: unknown; value: unknown };
type Outputs = { element: HTMLInputElement; value: number };

export default function node_slider1(ctx: NodeContext<Outputs>): NodeInstance<Inputs> {
  const input = h('input', { type: 'range', class: 'hlg-slider', min: 0, max: 1, step: 'any' });
  ctx.listen(input, 'input', () => ctx.emit('value', input.valueAsNumber));
  ctx.emit('element', input);              // values are replayed to wires connected later
  ctx.emit('value', input.valueAsNumber);
  return {
    inputs: {                              // one handler per input port name
      value(v, info) { input.value = String(v); void info; },
      min(v) { input.min = String(v); },
      max(v) { input.max = String(v); },
    },
    start() {},                            // optional: after the whole graph is wired
    dispose() {},                          // optional: release what ctx.* does not
  };
}
```

`ctx` (per node, `NodeContext<Outputs>`):

| member | purpose |
|---|---|
| `ctx.id`, `ctx.meta` | node id; meta given to `g.add` (`NodeMeta`: `type`, `action`, `graph`, …) |
| `ctx.app` | shared app services (`AppServices`, below) |
| `ctx.graph` | the graph this node belongs to (`Graph`) |
| `ctx.emit(port, value, { replay })` | send a value (`replay: false` → an event, not replayed); `port` and `value` are checked against `Outputs` |
| `ctx.bang(port)` | send an event without payload (`BANG`); only ports typed `Bang` in `Outputs` |
| `ctx.lastValue(port)` | last value emitted on one of this node's outputs (`Outputs[port] \| undefined`) |
| `ctx.listen(target, type, fn, opts)` | `addEventListener`, removed automatically on dispose; a throwing handler is reported with the node id; the event type is inferred for every target — elements (`'pointermove'` → `PointerEvent`), `window`, `document`, and Web API objects (`MIDIInput` `'midimessage'` → `MIDIMessageEvent`, `WebSocket` `'message'` → `MessageEvent`, `MediaQueryList` `'change'`, an oscillator's `'ended'`, `SpeechSynthesisUtterance`, `FileReader`…) — no casts needed |
| `ctx.onFrame(fn)` | `fn(timeMs, dtSeconds, frame)` every animation frame, stopped on dispose; a throwing callback is reported with the node id and keeps running |
| `ctx.onDispose(fn)` | cleanup callback |
| `ctx.error(err)` | report a runtime problem (console + visible banner in the page) |
| `ctx.attachment(name)` | URL (relative to the app base) of the node's embedded file `name` — see [Attachments](#attachments-embedded-files); throws for an unknown name |
| `ctx.attachments` | the node's embedded files (`readonly NodeAttachment[]`: `{ name, url, mime, role }`), frozen, in graph order; `[]` when none |

Input handlers receive `(value, info)` with `info: DeliveryInfo = { from, port, slot, event }`: source
node id and output port, `slot` = index of the wire among the wires into this input (fan-in order, in
`connect` order), `event` = true for bangs/events. Their return value is ignored, so concise arrows
(`(v) => (el.textContent = String(v))`) and `async` handlers are fine.

### Graphs

A second node for the wiring example — a label showing the slider value:

```ts
// src/nodes/main/label1.ts — node label1 of graph main
import { h, toNumber, type NodeContext, type NodeInstance } from '../../hlg-runtime.ts';

type Inputs = { text: unknown };
type Outputs = { element: HTMLParagraphElement };

export default function node_label1(ctx: NodeContext<Outputs>): NodeInstance<Inputs> {
  const el = h('p', { class: 'hlg-label' }, '–');
  ctx.emit('element', el);
  return { inputs: { text: (v) => (el.textContent = toNumber(v).toFixed(2)) } };
}
```

The graph's wiring file adds every node (in YAML order) and connects every wire once:

```ts
// src/graphs/main.ts — the wiring of graph main
import { createGraph, type Graph, type GraphDeps } from '../hlg-runtime.ts';
import node_slider1 from '../nodes/main/slider1.ts';
import node_label1 from '../nodes/main/label1.ts';

export default function graph_main({ app }: GraphDeps): Graph {    // a graph factory (GraphFactory)
  const g = createGraph({ app, name: 'main' });
  g.add('slider1', node_slider1, { type: 'ui/slider', action: 'Volume 0–1' });
  g.add('label1', node_label1, { type: 'ui/label', action: 'Show the slider value' });
  g.connect('slider1', 'value', 'label1', 'text');
  return g;
}
```

Subgraphs (`graphInput`, `graphOutput`, `subgraph`, one wiring file per graph): `process/compile.md` §4.2.

| member | purpose |
|---|---|
| `createGraph({ app, name, maxDeferred })` | new graph (`GraphOptions`; `maxDeferred`: feedback hops per task before yielding, default 1000) |
| `g.add(id, factory, meta)` | add a node; a **graph factory** also works here (it becomes a subgraph node) |
| `g.connect(fromId, outPort, toId, inPort)` | wire; fan-out and fan-in allowed; the source's last value is replayed to the new wire |
| `g.disconnect(fromId, outPort, toId, inPort)` | remove a wire |
| `g.send(toId, inPort, value, { event })` | push a value into a node input from outside |
| `g.start()` / `g.dispose()` | start nodes (add order) / dispose them (reverse order); both idempotent |
| `g.lastValue(id, port)`, `g.nodeIds()` | inspection (also handy in the browser console via `__hlg.graph`) |
| `g.interface`, `g.input(name, value)`, `g.onOutput(fn)` | subgraph interface (`GraphInterface`, `GraphOutputListener`; used by the runtime) |
| `graphInput(name)` / `graphOutput(name)` | factories for graph-input / graph-output nodes |
| `subgraph(graphFactory)` | explicit wrapper to use a graph factory as a node |

Wires are strings (`g.connect('a', 'out', 'b', 'in')`) and are not type-checked; the graph file is the
source of truth for them.

Delivery is synchronous and in wire order. A value that would re-enter a node still handling a value
(a feedback loop) is deferred to a microtask, so loops never overflow the stack; endless loops yield to
the browser every `maxDeferred` hops and log one warning.

Errors thrown by factories, handlers, `start()`, frame callbacks and `ctx.listen` handlers are
caught, reported through `app.reportError` (console + banner, naming the node) and never stop the rest
of the graph. A repeating error (e.g. every frame) is logged three times and then only counted in the
banner (`message (×120)`); the banner lists at most ten distinct messages.

### App services (`ctx.app: AppServices`, created once by `createApp` in main.ts)

| member | purpose |
|---|---|
| `createApp({ name, root, errorOverlay })` | `AppOptions`; `root`: element or selector (default `#app`, falls back to `body`) |
| `app.root`, `app.mount(el, parent?)` → unmount | place elements; the output node mounts the page |
| `app.container(name)` | a named `<div>` region created once (e.g. `'messages'`, `'overlay'`) |
| `app.h(tag, props, …children)` (also exported as `h`) | tiny DOM builder: `class`, `style` (string/object; numbers get no unit), `dataset`, `on<event>` (lowercase, typed events), booleans; the result type follows the tag (`h('canvas')` → `HTMLCanvasElement`) |
| `svg(tag, props, …children)` (exported) | the same for SVG elements — use it for everything inside an `<svg>` (`h('circle')` would not render) |
| `app.onFrame(fn)` → unsubscribe | the shared requestAnimationFrame loop |
| `app.state.get/set/has/delete/subscribe/snapshot` | tiny in-memory key/value store shared by all nodes (`StateStore`; `state.get<number>('k')`, `state.get('k', 0)`) |
| `app.storage.get(key, fallback)/set/remove` | persistent JSON storage, namespaced per app (`hlgapp:<name>:`) (`AppStorage`) |
| `app.audioContext()` | the shared `AudioContext` (lazy; one per app) |
| `app.requireUserGesture({ title, text, button })` | shows a "click to start" overlay until the first user gesture; resolves after it (and resumes audio) |
| `app.onUserGesture(fn)`, `app.hadUserGesture`, `app.unlockAudio()`, `app.audioRunning` | gesture/audio helpers |
| `app.reportError(err, context)`, `app.onError(fn)` | error reporting (`ErrorContext`, `ErrorListener`) |
| `app.dispose()` | stop frames, close audio, run disposers, remove containers, overlay and error banner |

Gestures are detected the way browsers grant "user activation": a click, a key (not Escape), a
mouse press, or the END of a tap (a touch `pointerdown` does not count — browsers refuse to start
audio there). A later gesture resumes the AudioContext again if the OS interrupted it (iOS); a
context the app suspended itself (`audioContext().suspend()`, e.g. a pause button) stays suspended
until the app calls `app.unlockAudio()`. A context created after the first gesture is resumed
immediately.

### Types

| type | what it is |
|---|---|
| `NodeFactory<In, Out>` | a node module's default export: `(ctx: NodeContext<Out>) => NodeInstance<In> \| Graph \| void` |
| `NodeContext<Out>` | the per-node API above; `Out` = the output port types |
| `NodeInstance<In>` | `{ inputs?, start?, dispose? }`; `In` = the input port types |
| `InputHandlers<In>`, `InputHandler<T>` | the `inputs` object / one handler `(value: T, info: DeliveryInfo) => void` |
| `Ports`, `PortName<P>`, `BangPort<P>` | the default port map (`Record<string, unknown>`), its names, the ports that may carry a `Bang` |
| `Bang` | the type of `BANG` |
| `DeliveryInfo` | `{ from, port, slot, event }` |
| `EmitOptions` | `{ replay?: boolean }` |
| `NodeMeta` | the meta object of `g.add` (`type`, `action`, `graph`, `attachments`, anything else) |
| `NodeAttachment` | one embedded file of a node: `{ name, url, mime, role: 'embed' }` (`ctx.attachments`, `meta.attachments`) |
| `FrameCallback` | `(timeMs, dtSeconds, frame) => void` |
| `Listen`, `ListenOptions`, `EventFor<T, K>` | the typed signature of `ctx.listen`, its options, and the event type target `T` delivers for event `K` (read from its `on<K>` property; `Event` for custom events) |
| `Graph`, `GraphFactory`, `GraphDeps`, `GraphOptions`, `GraphInterface`, `GraphOutputListener` | graphs and graph factories (`({ app }: GraphDeps) => Graph`) |
| `AppServices` (short: `App`), `AppOptions`, `StateStore`, `AppStorage`, `GestureOverlayOptions`, `ErrorContext`, `ErrorListener` | app services |
| `ElementProps`, `EventHandlerProps`, `Child` | props and children of `h` / `svg` |

### Helpers

`BANG`, `isBang(v)` (a type guard), `toNumber(v, fallback)`, `clamp(v, min, max)`, `lerp(a, b, t)`,
`mapRange(v, inMin, inMax, outMin, outMax, clamp?)`, `mtof(note)`, `h`, `svg`. `HLG_RUNTIME_VERSION`
is the runtime's version (the API only grows, so node modules reused from older TypeScript compiles
keep working; 2.0.0 is the first TypeScript version, 2.1.0 added `ctx.attachment` / `ctx.attachments`).

Naming in generated code (`process/compile.md` §4.3): node factories are `node_<id>`, graph factories
`graph_<name>`, with every character outside `A–Z a–z 0–9 _` replaced by `_`. TypeScript conventions
(no `any`, null checks, library types): `process/compile.md` §4.4.

---

## Styles (`src/style.css`)

Theme variables on `:root` (`--hlg-bg`, `--hlg-surface`, `--hlg-text`, `--hlg-accent`, `--hlg-radius`, …) with a
light variant under `prefers-color-scheme: light`. The output node's `style` input may override them:
an object `{ accent: '#ff3d7f', bg: '#000' }` sets `--hlg-accent`/`--hlg-bg` on `<html>` (keys starting
with `--` are used as they are). Classes the node modules use:

- page: `hlg-output` (+ `hlg-output--centered`, `hlg-output--full`), `hlg-title`, `hlg-text`
- layout: `hlg-row`, `hlg-col`, `hlg-grid`, `hlg-panel` (+ `hlg-panel__title`), `hlg-field` (+ `__label`, `__value`)
- controls: `hlg-button` (+ `--primary`, `--big`), `hlg-slider`, `hlg-knob`, `hlg-toggle`, `hlg-input`,
  `hlg-number`, `hlg-select`, `hlg-color`, `hlg-xy-pad`, `hlg-label` (+ `--big`), `hlg-list`, `hlg-keyboard`
  (+ `__key`, `__key--black`)
- visuals: `hlg-canvas` (+ `--full`), `hlg-media`, `hlg-dropzone`, `hlg-message` (+ `--warning`)
- runtime: `hlg-start-overlay`, `hlg-error`

Extend the file per app (the output node's action is the design brief); keep the variables so the
light/dark switch keeps working.

---

## Attachments (embedded files)

A node in the graph can carry **attachments** (`attachments` in the resolved graph). Only the ones with
`role: embed` are shipped with the app — a sample for `media/audio`, the picture for `media/image`, the
CSV for `data/csv`, a texture for `graphics/shader`. (`reference` attachments — sketches, screenshots,
example sounds — guide the compiler and are never copied into the app.)

1. The compiler copies each embedded file from the compile snapshot to
   `app/public/assets/<nodeId>/<file name>` (`process/compile.md` Step 7). Vite copies `public/` as it
   is, so the build has it at `assets/<nodeId>/<file name>` next to `index.html`.
2. The node's `g.add` meta lists them — `url` relative, no leading `/`:

```ts
// src/graphs/examples/sketch-to-app.ts (excerpt) — node chime carries one embedded sound
import { createGraph, type Graph, type GraphDeps } from '../../hlg-runtime.ts';
import node_chime from '../../nodes/examples/sketch-to-app/chime.ts';

export default function graph_examples_sketch_to_app({ app }: GraphDeps): Graph {
  const g = createGraph({ app, name: 'examples/sketch-to-app' });
  g.add('chime', node_chime, {
    type: 'media/audio',
    action: 'Plays the attached chime',
    attachments: [{ name: 'chime', url: 'assets/chime/7d2e3c5b90a1f4e6-chime.wav', mime: 'audio/wav', role: 'embed' }],
  });
  return g;
}
```

3. The module reads the URL by the attachment's name:

```ts
// src/nodes/examples/sketch-to-app/chime.ts — plays the node's embedded sound
import { type NodeContext, type NodeInstance } from '../../../hlg-runtime.ts';

type Inputs = { play: unknown };
type Outputs = { playing: boolean };

export default function node_chime(ctx: NodeContext<Outputs>): NodeInstance<Inputs> {
  const audio = new Audio(ctx.attachment('chime'));   // 'assets/chime/7d2e3c5b90a1f4e6-chime.wav'
  audio.preload = 'auto';
  ctx.listen(audio, 'play', () => ctx.emit('playing', true));
  ctx.listen(audio, 'ended', () => ctx.emit('playing', false));
  ctx.emit('playing', false);
  return {
    inputs: {
      async play() {
        await ctx.app.requireUserGesture({ text: 'Click to start the sound' });
        audio.currentTime = 0;
        await audio.play();
      },
    },
    dispose: () => audio.pause(),
  };
}
```

`ctx.attachment(name)` matches the name ignoring case; an unknown name throws an error that names the
node and the attachments it has (reported in the page with the node id). A relative URL resolves
against the page, so it works under `/preview/<id>/` and `/preview/latest/`. Malformed meta entries
(no name or url, a duplicate name, a `reference` role, an absolute `/…` URL) are reported in the page,
never thrown. `fetch(ctx.attachment('rows'))` reads a text or JSON file; `img.src = …`, `new Audio(…)`
and `video.src = …` load media. A Worker or AudioWorklet resolves relative URLs against its own script,
so pass it `new URL(ctx.attachment('chime'), document.baseURI).href`.

## Assets

Import files placed under `src/assets/` (`import sampleUrl from './assets/kick.wav'` — typed by
`vite-env.d.ts`) — Vite bundles and fingerprints them and the URL stays relative. A `public/` folder
also works (copied as-is to the build root; reference with `new URL('./file.ext', document.baseURI)`);
`public/assets/` is reserved for embedded attachments (above) — the seeded-compile clean-up deletes
anything else there. Never load files from CDNs or absolute `/…` paths.
