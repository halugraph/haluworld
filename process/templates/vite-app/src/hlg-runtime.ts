/**
 * hlg-runtime.ts — the tiny, dependency-free, strongly typed dataflow runtime of halugraph-generated apps.
 *
 * Copied verbatim into every compile (agents/compiles/<id>/app/src/hlg-runtime.ts). Do not edit the
 * copy inside a compile; if the runtime itself needs a fix, tell the user (it lives in
 * process/templates/vite-app/src/hlg-runtime.ts).
 *
 * Model
 *   - A graph holds nodes. A node is created by a {@link NodeFactory} `factory(ctx)` that returns
 *     `{ inputs: { <port>(value, info) {…} }, start?(), dispose?() }` (a {@link NodeInstance}) or nothing.
 *   - Nodes send values with `ctx.emit(port, value)` (values: the last one is replayed to wires
 *     connected later) or `ctx.bang(port)` (events: never replayed).
 *   - `graph.connect(fromId, outPort, toId, inPort)` wires ports. Fan-out and fan-in are allowed;
 *     `info.slot` tells a fan-in input which wire (0-based, in connect order) a value came from.
 *   - Delivery is synchronous. A send that would re-enter a node that is still handling a value
 *     (feedback loop) is deferred to a microtask, so cycles never overflow the stack; endless
 *     loops yield to the browser every `maxDeferred` hops so the page stays responsive.
 *   - Graph factories (`({ app }) => graph`) are usable as nodes (subgraphs): values sent to the
 *     node's inputs enter through `graphInput(name)` nodes, `graphOutput(name)` nodes leave it.
 *
 * Typing
 *   - Ports are described by plain object types: `type Outputs = { element: HTMLButtonElement; clicked: Bang }`.
 *     `NodeContext<Outputs>` then type-checks every `ctx.emit(port, value)` / `ctx.bang(port)`, and
 *     `NodeInstance<Inputs>` types the input handlers. Wires are not checked at run time, so input
 *     values are best typed `unknown` and coerced (`toNumber`, `instanceof Node`, `typeof`).
 *   - Nothing here needs `any`; generated code must not use it either.
 */

/** Runtime version. The API only grows (additive changes), so node modules from older compiles keep working. */
export const HLG_RUNTIME_VERSION = '2.1.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A port map: port name → the type of the values on that port. The default allows any port name
 * with values of unknown type; nodes narrow it with their own object types.
 */
export type Ports = Record<string, unknown>;

/** The port names of a port map (string keys only). */
export type PortName<P extends object> = Extract<keyof P, string>;

/** The ports of `P` that may carry a {@link Bang} (every port of the default {@link Ports}). */
export type BangPort<P extends object> = { [K in PortName<P>]: Bang extends P[K] ? K : never }[PortName<P>];

/** The payload of a bang (an event without data). Check with {@link isBang}. */
export type Bang = Readonly<{ hlgBang: true }>;

/** Where a delivered value came from. Passed as the second argument of every input handler. */
export interface DeliveryInfo {
  /** Source node id (`null` when sent from outside with `graph.send` / `graph.input`). */
  readonly from: string | null;
  /** Source output port (`null` from outside). */
  readonly port: string | null;
  /** Index of the wire among the wires into this input, in connect order (`-1` from outside). */
  readonly slot: number;
  /** `true` for events (bangs, `replay: false` emits). */
  readonly event: boolean;
}

/**
 * Handles values arriving on one input port. Its return value is ignored, so it may be `async` (or a
 * concise arrow like `(v) => (el.textContent = String(v))`); a rejected promise is reported with the node id.
 */
export type InputHandler<T = unknown> = (value: T, info: DeliveryInfo) => void;

/** One handler per input port name. */
export type InputHandlers<In extends object = Ports> = { [K in keyof In]?: InputHandler<In[K]> };

/** What a node factory returns. Every member is optional. */
export interface NodeInstance<In extends object = Ports> {
  /** Input handlers keyed by port name (quote hyphenated names: `'in-min'(v) {…}`). */
  inputs?: InputHandlers<In>;
  /** Called once after the whole graph is wired (`graph.start()`); may be `async` (a rejection is reported with the node id). */
  start?(): void;
  /** Release what `ctx.listen` / `ctx.onFrame` / `ctx.onDispose` do not. */
  dispose?(): void;
}

/** Options of `ctx.emit`. */
export interface EmitOptions {
  /** `false` sends an event: not stored, not replayed to wires connected later. */
  replay?: boolean;
}

/**
 * A file shipped with the app for one node: an **embed** attachment of the node in the graph (spec §12).
 * The compiler copies it to `app/public/assets/<nodeId>/<file name>` and lists it in the node's
 * `g.add` meta; the node reads its URL with `ctx.attachment(name)`.
 */
export interface NodeAttachment {
  /** The attachment's name in the graph (unique per node, compared ignoring case). */
  readonly name: string;
  /** URL relative to the app base, e.g. `assets/player/9f2c4e1a0b3d5c7e-chime.wav` — never starting with `/`. */
  readonly url: string;
  /** MIME type from the graph (e.g. `audio/wav`); `""` when unknown. */
  readonly mime: string;
  /** Always `embed`: reference attachments guide the compiler and are never shipped. */
  readonly role: 'embed';
}

/** Free-form node metadata given to `graph.add` (available as `ctx.meta`). */
export interface NodeMeta {
  /** Node type name, e.g. `ui/slider`. */
  type?: string;
  /** The artist's action text. */
  action?: string;
  /** Target graph of a `subgraph` node. */
  graph?: string;
  /** The node's embedded files (its `embed` attachments), read with `ctx.attachment(name)`. */
  attachments?: readonly NodeAttachment[];
  /** Anything else the wiring wants to record (e.g. `label`). */
  [key: string]: unknown;
}

/** An animation-frame callback: time in ms, seconds since the previous frame, frame index. */
export type FrameCallback = (timeMs: number, dtSeconds: number, frame: number) => void;

/** Options of `addEventListener`. */
export type ListenOptions = boolean | AddEventListenerOptions;

/**
 * The event type that target `T` delivers for event `K`, read from its `on<K>` handler property:
 * `EventFor<MIDIInput, 'midimessage'>` is `MIDIMessageEvent`, `EventFor<WebSocket, 'message'>` is
 * `MessageEvent`, `EventFor<MediaQueryList, 'change'>` is `MediaQueryListEvent`. Plain `Event` when the
 * target has no such property (custom events).
 */
export type EventFor<T, K extends string> = `on${K}` extends keyof T
  ? NonNullable<T[`on${K}` & keyof T]> extends (this: never, event: infer E) => unknown
    ? E extends Event
      ? E
      : Event
    : Event
  : Event;

/**
 * `ctx.listen(target, type, handler, options?)` — `addEventListener` that is removed automatically on
 * dispose; a throwing handler is reported with the node id. Returns a function that removes it early.
 * The event type is inferred for every target: windows, documents, HTML and SVG elements through their
 * event maps, any other Web API object (MIDIInput, WebSocket, MediaQueryList, AudioContext, an
 * oscillator's `ended`, SpeechSynthesisUtterance, FileReader…) through {@link EventFor}.
 */
export interface Listen {
  <K extends keyof WindowEventMap>(target: Window, type: K, handler: (event: WindowEventMap[K]) => void, options?: ListenOptions): () => void;
  <K extends keyof DocumentEventMap>(target: Document, type: K, handler: (event: DocumentEventMap[K]) => void, options?: ListenOptions): () => void;
  <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: ListenOptions): () => void;
  <K extends keyof SVGElementEventMap>(target: SVGElement, type: K, handler: (event: SVGElementEventMap[K]) => void, options?: ListenOptions): () => void;
  <T extends EventTarget, K extends string>(target: T, type: K, handler: ((event: EventFor<T, K>) => void) | EventListenerObject, options?: ListenOptions): () => void;
}

/**
 * The per-node API passed to a {@link NodeFactory}. `Out` describes the node's output ports, so
 * `emit` / `bang` / `lastValue` are checked against it.
 */
export interface NodeContext<Out extends object = Ports> {
  /** The node id (as in the graph file). */
  readonly id: string;
  /** The meta object given to `graph.add` (`type`, `action`, …). */
  readonly meta: NodeMeta;
  /** Shared app services. */
  readonly app: AppServices;
  /** The graph this node belongs to. */
  readonly graph: Graph;
  /** Send a value on an output port (replayed to wires connected later unless `{ replay: false }`). */
  emit<K extends PortName<Out>>(port: K, value: Out[K], opts?: EmitOptions): void;
  /** Send an event without payload ({@link BANG}); never replayed. */
  bang(port: BangPort<Out>): void;
  /** The last value emitted on one of this node's outputs (`undefined` when none / only events). */
  lastValue<K extends PortName<Out>>(port: K): Out[K] | undefined;
  /** Register cleanup that runs when the graph is disposed. */
  onDispose(fn: () => void): void;
  /** Run `cb` every animation frame until dispose; a throwing callback is reported with the node id. */
  onFrame(cb: FrameCallback): () => void;
  /** `addEventListener`, removed automatically on dispose (see {@link Listen}). */
  readonly listen: Listen;
  /** Report a runtime problem (console + a visible banner in the page), naming this node. */
  error(err: unknown): void;
  /** The node's embedded files (from `meta.attachments`), in graph order; frozen. Empty when it has none. */
  readonly attachments: readonly NodeAttachment[];
  /**
   * The URL (relative to the app base) of the embedded attachment `name` — matched ignoring case and
   * surrounding spaces. Use it with `new Audio(url)`, `img.src = url`, `fetch(url)`. Throws an error
   * naming the node and its attachments when there is no such attachment.
   */
  attachment(name: string): string;
}

/**
 * A node module's default export: called once per node instance with its context; returns the node
 * instance (or a {@link Graph}, which then becomes a subgraph node). Must be synchronous.
 */
export type NodeFactory<In extends object = Ports, Out extends object = Ports> = (ctx: NodeContext<Out>) => NodeInstance<In> | Graph | void;

/** What a graph factory receives. */
export interface GraphDeps {
  /** The shared app services; pass them on to `createGraph({ app, name })`. */
  app: AppServices;
}

/** A graph module's default export: builds and returns the graph. Usable as the entry graph or as a subgraph node. */
export type GraphFactory = (deps: GraphDeps) => Graph;

/** The call interface of a graph: graph-input / graph-output port names in add order. */
export interface GraphInterface {
  /** Names of the graph's `graphInput(name)` nodes (the subgraph node's input ports). */
  inputs: string[];
  /** Names of the graph's `graphOutput(name)` nodes (the subgraph node's output ports). */
  outputs: string[];
}

/** Receives graph-output values: output name, value and delivery info. */
export type GraphOutputListener = (name: string, value: unknown, info: Partial<DeliveryInfo>) => void;

/** Options of {@link createGraph}. */
export interface GraphOptions {
  /** Shared app services (default: a new `createApp()`). */
  app?: AppServices;
  /** Graph name, used in messages (default `"graph"`). */
  name?: string;
  /** Deferred (feedback) deliveries per browser task before yielding (default 1000). */
  maxDeferred?: number;
}

/** A dataflow graph (see {@link createGraph}). */
export interface Graph {
  /** The shared app services every node of this graph uses. */
  readonly app: AppServices;
  /** The graph name given to {@link createGraph} (used in messages). */
  readonly name: string;
  /**
   * Add a node. `factory(ctx)` returns the node instance, or a Graph (then it becomes a subgraph node).
   * `meta` is free-form (type, action, graph…) and is available as `ctx.meta`.
   */
  add<In extends object = Ports, Out extends object = Ports>(id: string, factory: NodeFactory<In, Out>, meta?: NodeMeta): Graph;
  /** Wire output `outPort` of `fromId` to input `inPort` of `toId`. Replays the source's last value. */
  connect(fromId: string, outPort: string, toId: string, inPort: string): Graph;
  /** Remove one wire; returns true when it existed. */
  disconnect(fromId: string, outPort: string, toId: string, inPort: string): boolean;
  /** Deliver a value straight into a node input (from outside the graph). */
  send(toId: string, inPort: string, value: unknown, opts?: { event?: boolean }): Graph;
  /** Last value emitted on a node's output port (`undefined` when none / only events). */
  lastValue(id: string, port: string): unknown;
  /** Node ids in add order. */
  nodeIds(): string[];
  /** Call every node's `start()` once, in add order. Idempotent. */
  start(): Graph;
  /** Dispose every node (reverse add order), drop wires and pending deliveries. Idempotent. */
  dispose(): void;
  /** `true` once `start()` ran. */
  readonly started: boolean;
  /** `true` once `dispose()` ran; a disposed graph ignores sends and emits. */
  readonly disposed: boolean;
  /** The graph's call interface: graph-input / graph-output port names in add order. */
  readonly interface: GraphInterface;
  /** Feed a value into the graph-input node(s) named `inputName`; returns how many received it. */
  input(inputName: string, value: unknown, info?: { event?: boolean }): number;
  /** Listen to graph-output values. Replays the last value of each output. Returns an unsubscribe function. */
  onOutput(cb: GraphOutputListener): () => void;
  /** @internal used by graphOutput nodes */
  _output(outName: string, value: unknown, info: Partial<DeliveryInfo>): void;
}

/** Where an error happened (all fields optional; the runtime fills in what it knows). */
export interface ErrorContext {
  /** Name of the graph the node belongs to. */
  graph?: string;
  /** Id of the node that failed (the banner shows `[node <id>.<port>]`). */
  node?: string;
  /** Input port whose handler failed. */
  port?: string;
  /** `create`, `start`, `frame`, `event` or `dispose`. */
  phase?: string;
  /** More detail (e.g. `event: 'click'`, `state: '<key>'`). */
  [key: string]: unknown;
}

/** Receives every reported error. */
export type ErrorListener = (error: unknown, context: ErrorContext) => void;

/** Options of {@link createApp}. */
export interface AppOptions {
  /** App name: namespaces storage keys (default `"halugraph-app"`). */
  name?: string;
  /** Mount point: element or selector (default `"#app"`, else `body`). */
  root?: string | HTMLElement;
  /** `false` hides the in-page error banner (default `true`). */
  errorOverlay?: boolean;
}

/** Texts of the "click to start" overlay shown by `app.requireUserGesture()`. */
export interface GestureOverlayOptions {
  /** Heading (default: the page title or the app name). */
  title?: string;
  /** A sentence under the heading. */
  text?: string;
  /** Button label (default `"Click to start"`). */
  button?: string;
}

/** Tiny in-memory key/value store shared by all nodes (`app.state`). Values are not checked at run time. */
export interface StateStore {
  /** The value stored under `key`, or `undefined` (`state.get<number>('bpm')`). */
  get<T = unknown>(key: string): T | undefined;
  /** The value stored under `key`, or `fallback` when there is none (`state.get('bpm', 120)`). */
  get<T>(key: string, fallback: T): T;
  /** Whether `key` holds a value. */
  has(key: string): boolean;
  /** Set a value; subscribers run when it changed (`Object.is`). */
  set(key: string, value: unknown): void;
  /** Remove `key`; subscribers receive `undefined`. */
  delete(key: string): void;
  /** Called on every change of `key` (not immediately); returns an unsubscribe function. */
  subscribe<T = unknown>(key: string, cb: (value: T | undefined) => void): () => void;
  /** A plain-object copy of every value. */
  snapshot(): Record<string, unknown>;
}

/** Persistent JSON storage, namespaced per app (`hlgapp:<name>:`), in memory when localStorage is unavailable. */
export interface AppStorage {
  /** The stored JSON value of `key`, or `undefined` (unreadable values count as missing). */
  get<T = unknown>(key: string): T | undefined;
  /** The stored JSON value of `key`, or `fallback` (`storage.get('presets', [])`). */
  get<T>(key: string, fallback: T): T;
  /** Store `value` as JSON under `key` (a full or blocked storage only logs a warning). */
  set(key: string, value: unknown): void;
  /** Delete `key`. */
  remove(key: string): void;
}

/** The shared services every node reaches through `ctx.app` (created once by {@link createApp}). */
export interface AppServices {
  /** The app name given to {@link createApp} (it namespaces {@link AppServices.storage}). */
  readonly name: string;
  /** The mount point (resolved on every access). */
  readonly root: HTMLElement;
  /** The DOM builder ({@link h}). */
  readonly h: typeof h;
  /** Append `el` to `parent` (default: the root); returns a function that removes it again. */
  mount(el: Node, parent?: Node | null): () => void;
  /** A named `<div class="hlg-container">` region, created once. */
  container(name: string, parent?: Node | null): HTMLElement;
  /** Run `cb(timeMs, dtSeconds, frame)` every animation frame; returns an unsubscribe function. */
  onFrame(cb: FrameCallback): () => void;
  /** In-memory key/value store shared by all nodes (lost on reload). */
  readonly state: StateStore;
  /** Persistent JSON storage, namespaced per app (survives reloads). */
  readonly storage: AppStorage;
  /** The shared AudioContext (created lazily, one per app). */
  audioContext(): AudioContext;
  /** Resume the shared AudioContext unless it is running or closed. */
  unlockAudio(): Promise<void>;
  /** `true` while the shared AudioContext exists and is running. */
  readonly audioRunning: boolean;
  /** `true` once the page had a user gesture (click, tap, key) — sound may start. */
  readonly hadUserGesture: boolean;
  /** Run `fn` on the first user gesture (click/tap/key), or right away if one already happened. */
  onUserGesture(fn: () => void): void;
  /** Treat this moment as a user gesture (the runtime calls it on every user activation). */
  notifyUserGesture(): void;
  /** Resolve once the page has had a user gesture; shows a "click to start" overlay until then. */
  requireUserGesture(opts?: GestureOverlayOptions): Promise<void>;
  /** Report an error: console (repeats counted) + the in-page banner + `onError` listeners. */
  reportError(error: unknown, context?: ErrorContext): void;
  /** Listen to reported errors; returns an unsubscribe function. */
  onError(listener: ErrorListener): () => void;
  /** Register cleanup to run on `app.dispose()`. */
  onDispose(fn: () => void): void;
  /** Stop frames, close audio, run disposers, remove containers, overlay and error banner. Idempotent. */
  dispose(): void;
}

/** Short name of {@link AppServices}. */
export type App = AppServices;

/** The payload of a bang (an event without data). Check with `isBang(value)`. */
export const BANG: Bang = Object.freeze({ hlgBang: true as const });

/** True when `value` is the BANG payload. Handlers of bang inputs should accept any value, though. */
export function isBang(value: unknown): value is Bang {
  return value === BANG;
}

const GRAPH_MARK: unique symbol = Symbol.for('halugraph.graph');
const GRAPH_INPUT: unique symbol = Symbol.for('halugraph.graphInput');
const GRAPH_OUTPUT: unique symbol = Symbol.for('halugraph.graphOutput');

/** Node factories made by graphInput()/graphOutput() carry the port name under these symbols. */
interface MarkedFactory {
  [GRAPH_INPUT]?: string;
  [GRAPH_OUTPUT]?: string;
}

// ---------------------------------------------------------------------------
// Small helpers generated code may use
// ---------------------------------------------------------------------------

/** Clamp `v` into [min, max] (bounds may be given in either order). */
export function clamp(v: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation from a (t=0) to b (t=1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map `v` from [inMin, inMax] to [outMin, outMax]; `clampOutput` limits the result to the output range. */
export function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number, clampOutput = false): number {
  if (inMax === inMin) return outMin;
  const out = outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
  return clampOutput ? clamp(out, outMin, outMax) : out;
}

/** MIDI note number → frequency in Hz (A4 = note 69 = 440 Hz). */
export function mtof(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Loose number coercion for port values: numeric strings and booleans convert, anything else → fallback. */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** `on<event>` props of {@link h} / {@link svg} with typed events (`onclick`, `oninput`, `onpointerdown` …). */
export type EventHandlerProps = { [K in keyof HTMLElementEventMap as `on${K}`]?: (event: HTMLElementEventMap[K]) => void };

/** Props of {@link h} / {@link svg}. Any other key becomes an attribute. */
export type ElementProps = EventHandlerProps & {
  class?: string | null;
  className?: string | null;
  /** A CSS string, or an object of properties (camelCase or kebab-case; `--custom` variables allowed). Numbers get no unit. */
  style?: string | Record<string, string | number> | null;
  dataset?: Record<string, string>;
  [attribute: string]: unknown;
};

/** Children of {@link h} / {@link svg}: nodes, text, numbers, (nested) arrays; `null`/`undefined`/booleans are skipped. */
export type Child = Node | string | number | boolean | null | undefined | readonly Child[];

/**
 * Create a DOM element: `h('button', { class: 'hlg-button', onclick: fn, disabled: false }, 'Label')`.
 * Props: `class`/`className`, `style` (string or object, CSS variables allowed; numbers are NOT given
 * a unit — write '4px'), `dataset` (object), `on<event>` functions (added as listeners), booleans
 * (true → attribute, false → absent), and any other attribute; `value`/`checked`/`selected` are also
 * set as properties. Children may be strings, numbers, nodes or (nested) arrays;
 * null/undefined/false are skipped. `h('svg', …)` creates the SVG root in the SVG namespace; build its
 * children with `svg()`. The return type follows the tag (`h('input')` is an `HTMLInputElement`).
 */
export function h(tag: 'svg', props?: ElementProps | null, ...children: Child[]): SVGSVGElement;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: ElementProps | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, props?: ElementProps | null, ...children: Child[]): HTMLElement;
export function h(tag: string, props?: ElementProps | null, ...children: Child[]): HTMLElement | SVGSVGElement {
  const el = tag === 'svg' ? document.createElementNS(SVG_NS, 'svg') : document.createElement(tag);
  return build(el, props, children);
}

/**
 * Create an SVG element (`svg('circle', { cx: 50, cy: 50, r: 40, class: 'dot' })`) — same props and
 * children as `h()`. Use it for every element inside an `<svg>`; `h('circle')` would create an HTML
 * element that never renders.
 */
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, props?: ElementProps | null, ...children: Child[]): SVGElementTagNameMap[K];
export function svg(tag: string, props?: ElementProps | null, ...children: Child[]): SVGElement;
export function svg(tag: string, props?: ElementProps | null, ...children: Child[]): SVGElement {
  return build(document.createElementNS(SVG_NS, tag), props, children);
}

function build<E extends HTMLElement | SVGElement>(el: E, props: ElementProps | null | undefined, children: readonly Child[]): E {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null) continue;
    // setAttribute works for HTML and SVG alike (SVG's className is read-only).
    if (key === 'class' || key === 'className') el.setAttribute('class', String(value));
    else if (key === 'style') {
      if (typeof value === 'string') el.style.cssText = value;
      else {
        for (const [prop, v] of Object.entries(value as Record<string, unknown>)) {
          if (prop.startsWith('--') || prop.includes('-')) el.style.setProperty(prop, String(v));
          else (el.style as unknown as Record<string, string>)[prop] = String(v);
        }
      }
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (/^on[A-Za-z]/.test(key) && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (typeof value === 'boolean') {
      if (value) el.setAttribute(key, '');
      if (key in el) setProperty(el, key, value);
    } else {
      el.setAttribute(key, String(value));
      if (key === 'value' || key === 'checked' || key === 'selected') setProperty(el, key, value);
    }
  }
  appendChildren(el, children);
  return el;
}

function setProperty(el: Element, key: string, value: unknown): void {
  try {
    (el as unknown as Record<string, unknown>)[key] = value;
  } catch {
    /* read-only on this element (e.g. SVG): the attribute is enough */
  }
}

function appendChildren(el: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child as readonly Child[]);
    else if (typeof child === 'object' && 'nodeType' in child) el.appendChild(child as Node);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

// ---------------------------------------------------------------------------
// App services
// ---------------------------------------------------------------------------

type FrameHandle = { raf: number } | { timer: ReturnType<typeof setTimeout> };

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function';
}

function errorMessage(error: unknown): string {
  const message = error !== null && error !== undefined ? (error as { message?: unknown }).message : undefined;
  return message ? String(message) : String(error);
}

/**
 * Create the shared app services every node reaches through `ctx.app`:
 * DOM root/mount/containers, a shared animation-frame loop, a key/value state store, namespaced
 * persistent storage, the shared AudioContext with user-gesture unlocking, and error reporting.
 */
export function createApp(options: AppOptions = {}): AppServices {
  const name = options.name || 'halugraph-app';
  const disposers: Array<() => void> = [];
  const errorListeners = new Set<ErrorListener>();
  let disposed = false;

  // ---- errors --------------------------------------------------------------
  // A failing frame callback reports 60 errors per second: repeats are counted instead of logged,
  // and the banner shows each distinct message once (with a count), at most MAX_BANNER_ITEMS.
  const MAX_LOGGED_REPEATS = 3;
  const MAX_BANNER_ITEMS = 10;
  const errorCounts = new Map<string, number>(); // message -> occurrences
  let errorBanner: HTMLElement | null = null;
  let bannerItems = new Map<string, HTMLElement>(); // message -> <li>
  let bannerMore = 0;

  function showErrorBanner(message: string): void {
    if (options.errorOverlay === false || typeof document === 'undefined' || !document.body) return;
    if (!errorBanner || !errorBanner.isConnected) {
      const list = h('ul', { class: 'hlg-error__list' });
      const close = h('button', { class: 'hlg-error__close', type: 'button', 'aria-label': 'Dismiss errors', onclick: dismissErrorBanner }, '×');
      errorBanner = h('div', { class: 'hlg-error', role: 'alert' }, h('strong', null, 'Something went wrong'), close, list);
      bannerItems = new Map();
      bannerMore = 0;
      document.body.appendChild(errorBanner);
    }
    const list = errorBanner.querySelector('.hlg-error__list') as HTMLElement;
    let item = bannerItems.get(message);
    if (!item) {
      if (bannerItems.size >= MAX_BANNER_ITEMS) {
        bannerMore++;
        let more = list.querySelector('.hlg-error__more');
        if (!more) more = list.appendChild(h('li', { class: 'hlg-error__more' }));
        more.textContent = `…and ${bannerMore} more (see the browser console)`;
        return;
      }
      item = h('li', { 'data-count': '0' });
      const more = list.querySelector('.hlg-error__more');
      list.insertBefore(item, more);
      bannerItems.set(message, item);
    }
    const shown = Number(item.dataset.count) + 1;
    item.dataset.count = String(shown);
    item.textContent = shown > 1 ? `${message} (×${shown})` : message;
  }

  function dismissErrorBanner(): void {
    if (errorBanner) errorBanner.remove();
    errorBanner = null;
    bannerItems = new Map();
    bannerMore = 0;
  }

  function reportError(error: unknown, context: ErrorContext = {}): void {
    const where = context && context.node ? ` [node ${context.node}${context.port ? `.${context.port}` : ''}]` : '';
    const message = `${errorMessage(error)}${where}`;
    if (errorCounts.size > 500) errorCounts.clear();
    const count = (errorCounts.get(message) || 0) + 1;
    errorCounts.set(message, count);
    if (count <= MAX_LOGGED_REPEATS) console.error(`[hlg] ${message}`, error);
    else if (count === MAX_LOGGED_REPEATS + 1) console.error(`[hlg] ${message} — repeating; further repeats are only counted in the page`);
    for (const listener of [...errorListeners]) {
      try {
        listener(error, context);
      } catch (e) {
        console.error('[hlg] error listener failed', e);
      }
    }
    showErrorBanner(message);
  }

  function onError(listener: ErrorListener): () => void {
    errorListeners.add(listener);
    return () => {
      errorListeners.delete(listener);
    };
  }

  // ---- DOM -----------------------------------------------------------------
  function resolveRoot(): HTMLElement {
    if (typeof document === 'undefined') throw new Error('hlg-runtime: no document (the app must run in a browser)');
    if (options.root && typeof options.root === 'object') return options.root;
    const found = document.querySelector<HTMLElement>(typeof options.root === 'string' ? options.root : '#app');
    return found || document.body;
  }

  function mount(el: Node, parent?: Node | null): () => void {
    (parent || resolveRoot()).appendChild(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }

  const containers = new Map<string, HTMLElement>();
  function container(containerName: string, parent?: Node | null): HTMLElement {
    let el = containers.get(containerName);
    if (!el || !el.isConnected) {
      el = h('div', { class: `hlg-container hlg-container--${containerName}`, dataset: { hlgContainer: containerName } });
      mount(el, parent);
      containers.set(containerName, el);
    }
    return el;
  }

  // ---- animation frames ----------------------------------------------------
  const frameSubs = new Set<FrameCallback>();
  let frameGen = 0;
  let frameHandle: FrameHandle | null = null;
  let lastTime: number | null = null;
  let frameIndex = 0;

  function requestFrame(fn: (time: number) => void): FrameHandle {
    if (typeof globalThis.requestAnimationFrame === 'function') return { raf: globalThis.requestAnimationFrame(fn) };
    const now = (): number => (globalThis.performance ? globalThis.performance.now() : Date.now());
    return { timer: setTimeout(() => fn(now()), 16) };
  }
  function cancelFrame(handle: FrameHandle | null): void {
    if (!handle) return;
    if ('raf' in handle && handle.raf !== undefined && typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle.raf);
    if ('timer' in handle && handle.timer !== undefined) clearTimeout(handle.timer);
  }
  function scheduleFrame(): void {
    const gen = ++frameGen;
    frameHandle = requestFrame((time) => {
      if (gen !== frameGen) return;
      frameHandle = null;
      if (frameSubs.size === 0 || disposed) return;
      const dt = lastTime === null ? 0 : Math.max(0, (time - lastTime) / 1000);
      lastTime = time;
      const frame = frameIndex++;
      for (const cb of [...frameSubs]) {
        try {
          cb(time, dt, frame);
        } catch (e) {
          reportError(e, { frame });
        }
      }
      if (frameSubs.size > 0 && !disposed) scheduleFrame();
    });
  }
  function stopFrames(): void {
    frameGen++;
    cancelFrame(frameHandle);
    frameHandle = null;
    lastTime = null;
  }

  function onFrame(cb: FrameCallback): () => void {
    if (disposed) return () => {};
    frameSubs.add(cb);
    if (!frameHandle) scheduleFrame();
    return () => {
      frameSubs.delete(cb);
      if (frameSubs.size === 0) stopFrames();
    };
  }

  // ---- state store ---------------------------------------------------------
  const stateValues = new Map<string, unknown>();
  const stateSubs = new Map<string, Set<(value: unknown) => void>>();
  function notifyState(key: string, value: unknown): void {
    for (const cb of [...(stateSubs.get(key) || [])]) {
      try {
        cb(value);
      } catch (e) {
        reportError(e, { state: key });
      }
    }
  }
  const state: StateStore = {
    get: ((key: string, fallback?: unknown) => (stateValues.has(key) ? stateValues.get(key) : fallback)) as StateStore['get'],
    has: (key) => stateValues.has(key),
    set(key, value) {
      const had = stateValues.has(key);
      if (had && Object.is(stateValues.get(key), value)) return;
      stateValues.set(key, value);
      notifyState(key, value);
    },
    delete(key) {
      if (!stateValues.has(key)) return;
      stateValues.delete(key);
      notifyState(key, undefined);
    },
    subscribe<T>(key: string, cb: (value: T | undefined) => void): () => void {
      let subs = stateSubs.get(key);
      if (!subs) stateSubs.set(key, (subs = new Set()));
      const listener = cb as (value: unknown) => void;
      subs.add(listener);
      return () => {
        stateSubs.get(key)?.delete(listener);
      };
    },
    snapshot: () => Object.fromEntries(stateValues),
  };

  // ---- persistent storage (namespaced: all builds share the preview origin) --
  const memoryStore = new Map<string, string>();
  const prefix = `hlgapp:${name}:`;
  function local(): Storage | null {
    try {
      const ls = globalThis.localStorage;
      return ls && typeof ls.getItem === 'function' ? ls : null;
    } catch {
      return null;
    }
  }
  const storage: AppStorage = {
    get: ((key: string, fallback?: unknown) => {
      const ls = local();
      try {
        const raw = ls ? ls.getItem(prefix + key) : memoryStore.has(key) ? memoryStore.get(key) : null;
        return raw === null || raw === undefined ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    }) as AppStorage['get'],
    set(key, value) {
      const raw = JSON.stringify(value);
      const ls = local();
      try {
        if (ls) ls.setItem(prefix + key, raw);
        else memoryStore.set(key, raw);
      } catch (e) {
        console.warn(`[hlg] could not store "${key}"`, e);
      }
    },
    remove(key) {
      const ls = local();
      try {
        if (ls) ls.removeItem(prefix + key);
        else memoryStore.delete(key);
      } catch {
        /* ignore */
      }
    },
  };

  // ---- audio + user gesture ------------------------------------------------
  let audioCtx: AudioContext | null = null;
  let audioHasRun = false; // once running, a later 'suspended' is the app's own pause — gestures leave it alone
  let hadGesture = false;
  const gestureCallbacks: Array<() => void> = [];
  let overlay: HTMLElement | null = null;
  let overlayPromise: Promise<void> | null = null;
  let resolveOverlay: (() => void) | null = null;

  function audioContext(): AudioContext {
    if (audioCtx) return audioCtx;
    const g = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext || g.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not supported in this browser');
    const created = new Ctor();
    audioCtx = created;
    if (typeof created.addEventListener === 'function') {
      created.addEventListener('statechange', () => {
        if (audioCtx && audioCtx.state === 'running') audioHasRun = true;
      });
    }
    // Created after the page already had a gesture (a node that starts audio lazily): resume now,
    // some browsers (Safari) would otherwise keep it suspended.
    if (hadGesture) void unlockAudio();
    return created;
  }

  const stateOf = (context: AudioContext): string => context.state;

  /** Resume the shared AudioContext unless it is running or closed ('suspended', iOS 'interrupted'). */
  async function unlockAudio(): Promise<void> {
    if (audioCtx && audioCtx.state === 'running') audioHasRun = true;
    if (audioCtx && audioCtx.state !== 'running' && audioCtx.state !== 'closed' && typeof audioCtx.resume === 'function') {
      try {
        await audioCtx.resume();
        // Re-read the state: it changed while we awaited (TypeScript would keep the narrowed value).
        if (audioCtx && stateOf(audioCtx) === 'running') audioHasRun = true;
      } catch (e) {
        console.warn('[hlg] AudioContext.resume() failed', e);
      }
    }
  }

  /**
   * What a user gesture does to audio: start it when the browser's autoplay policy held it back (never
   * ran yet) or the OS interrupted it (iOS). A context the app suspended itself stays suspended.
   */
  function resumeAfterGesture(): void {
    if (!audioCtx) return;
    if (audioCtx.state === 'running') audioHasRun = true;
    else if (stateOf(audioCtx) === 'interrupted' || !audioHasRun) void unlockAudio();
  }

  /**
   * Called on every user activation (the runtime listens on the whole page until dispose, so a later
   * tap also resumes audio the OS interrupted). Runs queued callbacks and removes the overlay.
   */
  function notifyUserGesture(): void {
    hadGesture = true;
    resumeAfterGesture();
    while (gestureCallbacks.length) {
      const fn = gestureCallbacks.shift() as () => void;
      try {
        fn();
      } catch (e) {
        reportError(e, { gesture: true });
      }
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (resolveOverlay) {
      const r = resolveOverlay;
      resolveOverlay = null;
      overlayPromise = null;
      r();
    }
  }

  function onUserGesture(fn: () => void): void {
    if (hadGesture) {
      try {
        fn();
      } catch (e) {
        reportError(e, { gesture: true });
      }
    } else gestureCallbacks.push(fn);
  }

  /**
   * Resolve once the page has had a user gesture (needed for sound, speech, fullscreen…).
   * Shows a full-page "click to start" overlay until then. Concurrent calls share one overlay.
   */
  function requireUserGesture(opts: GestureOverlayOptions = {}): Promise<void> {
    if (hadGesture || (audioCtx && audioCtx.state === 'running')) return Promise.resolve();
    if (!overlayPromise) {
      overlayPromise = new Promise<void>((resolve) => {
        resolveOverlay = resolve;
      });
      if (typeof document !== 'undefined' && document.body) {
        const button = h('button', { class: 'hlg-start-overlay__button', type: 'button', onclick: () => notifyUserGesture() }, opts.button || 'Click to start');
        overlay = h(
          'div',
          { class: 'hlg-start-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || name },
          h('div', { class: 'hlg-start-overlay__card' }, h('h1', { class: 'hlg-start-overlay__title' }, opts.title || document.title || name), opts.text ? h('p', { class: 'hlg-start-overlay__text' }, opts.text) : null, button),
        );
        document.body.appendChild(overlay);
        try {
          button.focus();
        } catch {
          /* ignore */
        }
      }
    }
    const pending = overlayPromise;
    return pending.then(() => undefined);
  }

  // Only "activation-triggering" events unlock audio: a touch pointerdown is NOT one (the browser
  // would refuse to resume), the touchend/pointerup/click that follows is.
  const gestureEvents = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  function isUserActivation(event?: Event): boolean {
    const nav = globalThis.navigator as (Navigator & { userActivation?: { isActive?: unknown } }) | undefined;
    const activation = nav && nav.userActivation;
    if (activation && typeof activation.isActive === 'boolean') return activation.isActive;
    if (!event) return true;
    if (event.type === 'pointerdown') return (event as PointerEvent).pointerType !== 'touch' && (event as PointerEvent).pointerType !== 'pen';
    if (event.type === 'pointerup') return (event as PointerEvent).pointerType === 'touch' || (event as PointerEvent).pointerType === 'pen';
    if (event.type === 'keydown') return (event as KeyboardEvent).key !== 'Escape';
    return true;
  }
  const onAnyGesture = (event: Event): void => {
    if (isUserActivation(event)) notifyUserGesture();
  };
  function removeGestureListeners(): void {
    if (typeof globalThis.removeEventListener !== 'function') return;
    for (const type of gestureEvents) globalThis.removeEventListener(type, onAnyGesture, true);
  }
  if (typeof globalThis.addEventListener === 'function' && typeof document !== 'undefined') {
    for (const type of gestureEvents) globalThis.addEventListener(type, onAnyGesture, true);
  }

  // ---- lifecycle -----------------------------------------------------------
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    frameSubs.clear();
    stopFrames();
    removeGestureListeners();
    while (disposers.length) {
      try {
        (disposers.pop() as () => void)();
      } catch (e) {
        console.error('[hlg] app disposer failed', e);
      }
    }
    if (overlay) overlay.remove();
    overlay = null;
    dismissErrorBanner();
    for (const el of containers.values()) el.remove();
    containers.clear();
    if (audioCtx && typeof audioCtx.close === 'function') audioCtx.close().catch(() => {});
  }

  return {
    name,
    get root() {
      return resolveRoot();
    },
    h,
    mount,
    container,
    onFrame,
    state,
    storage,
    audioContext,
    unlockAudio,
    get audioRunning() {
      return !!audioCtx && audioCtx.state === 'running';
    },
    get hadUserGesture() {
      return hadGesture;
    },
    onUserGesture,
    notifyUserGesture,
    requireUserGesture,
    reportError,
    onError,
    onDispose: (fn) => {
      disposers.push(fn);
    },
    dispose,
  };
}

// ---------------------------------------------------------------------------
// Graphs
// ---------------------------------------------------------------------------

/** A node instance as the graph stores it (whatever the factory returned, checked at use). */
interface RuntimeInstance {
  inputs?: Record<string, unknown>;
  start?: unknown;
  dispose?: unknown;
}

interface NodeRecord {
  readonly id: string;
  readonly meta: NodeMeta;
  instance: RuntimeInstance | null;
  readonly lastValues: Map<string, unknown>;
  readonly disposers: Array<() => void>;
  started: boolean;
}

interface Wire {
  readonly to: string;
  readonly port: string;
  readonly slot: number;
}

type Delivery = [targetId: string, port: string, value: unknown, info: DeliveryInfo];

/** Create a dataflow graph. */
export function createGraph(options: GraphOptions = {}): Graph {
  const app = options.app || createApp();
  const name = options.name || 'graph';
  const maxDeferred = options.maxDeferred || 1000;

  const nodes = new Map<string, NodeRecord>();
  const order: string[] = [];
  const wires = new Map<string, Wire[]>(); // "id\u0000port" -> wires
  const slotCounters = new Map<string, number>(); // "id\u0000port" (target) -> next slot
  const active = new Set<string>();
  const warned = new Set<string>();
  const outputListeners = new Set<GraphOutputListener>();
  const lastOutputs = new Map<string, [unknown, Partial<DeliveryInfo>]>();
  const graphInputs: Array<{ id: string; name: string }> = [];
  const graphOutputs: Array<{ id: string; name: string }> = [];

  let queue: Delivery[] = [];
  let flushScheduled = false;
  let hops = 0;
  let hopResetScheduled = false;
  let loopWarned = false;
  let started = false;
  let disposed = false;

  const key = (id: string, port: string): string => `${id}\u0000${port}`;

  function warnOnce(tag: string, message: string): void {
    if (warned.has(tag)) return;
    warned.add(tag);
    console.warn(`[hlg] ${message}`);
  }

  function requireNode(id: string): NodeRecord {
    const node = nodes.get(id);
    if (!node) throw new Error(`hlg-runtime (${name}): unknown node "${id}"`);
    return node;
  }

  /** Report the rejection of a promise returned by generated code (async start()/handlers) with its node. */
  function watchAsync(result: unknown, context: ErrorContext): void {
    if (isThenable(result)) result.then(undefined, (e: unknown) => app.reportError(e, context));
  }

  function handlerFor(node: NodeRecord, port: string): InputHandler | null {
    const inputs = node.instance && node.instance.inputs;
    const fn = inputs ? inputs[port] : undefined;
    return typeof fn === 'function' ? (fn as InputHandler) : null;
  }

  function deliverNow(targetId: string, port: string, value: unknown, info: DeliveryInfo): void {
    if (disposed) return;
    const node = nodes.get(targetId);
    if (!node) return;
    if (active.has(targetId)) {
      defer(targetId, port, value, info);
      return;
    }
    const fn = handlerFor(node, port);
    if (!fn) {
      warnOnce(`h:${targetId}:${port}`, `node "${targetId}" has no input handler for "${port}" — value dropped`);
      return;
    }
    active.add(targetId);
    try {
      watchAsync(fn.call(node.instance?.inputs, value, info), { graph: name, node: targetId, port });
    } catch (e) {
      app.reportError(e, { graph: name, node: targetId, port });
    } finally {
      active.delete(targetId);
    }
  }

  function defer(targetId: string, port: string, value: unknown, info: DeliveryInfo): void {
    queue.push([targetId, port, value, info]);
    scheduleFlush();
  }

  function scheduleFlush(): void {
    if (flushScheduled || disposed) return;
    flushScheduled = true;
    if (hops >= maxDeferred) {
      if (!loopWarned) {
        loopWarned = true;
        console.warn(`[hlg] feedback loop in graph "${name}": more than ${maxDeferred} re-entrant deliveries in one task; yielding to keep the page responsive`);
      }
      setTimeout(flush, 0);
    } else queueMicrotask(flush);
  }

  function flush(): void {
    flushScheduled = false;
    if (disposed) {
      queue = [];
      return;
    }
    const batch = queue;
    queue = [];
    for (const [targetId, port, value, info] of batch) {
      if (disposed) return;
      hops++;
      if (!hopResetScheduled) {
        hopResetScheduled = true;
        setTimeout(() => {
          hops = 0;
          hopResetScheduled = false;
        }, 0);
      }
      deliverNow(targetId, port, value, info);
    }
  }

  function emitFrom(id: string, port: string, value: unknown, opts: EmitOptions = {}): void {
    if (disposed) return;
    const node = nodes.get(id);
    if (!node) return;
    const event = opts.replay === false;
    if (!event) node.lastValues.set(port, value);
    const targets = wires.get(key(id, port));
    if (!targets) return;
    for (const wire of [...targets]) deliverNow(wire.to, wire.port, value, { from: id, port, slot: wire.slot, event });
  }

  function makeContext(id: string, meta: NodeMeta): NodeContext {
    const attachments = readAttachments(id, meta, (e) => app.reportError(e, { graph: name, node: id, phase: 'create' }));
    const onDispose = (fn: () => void): void => {
      nodes.get(id)?.disposers.push(fn);
    };
    const listen = (target: EventTarget, type: string, handler: ((event: Event) => void) | EventListenerObject, listenerOptions?: ListenOptions): (() => void) => {
      const wrapped = function (this: EventTarget, event: Event): void {
        try {
          if (typeof handler === 'function') handler.call(this, event);
          else handler.handleEvent(event);
        } catch (e) {
          app.reportError(e, { graph: name, node: id, phase: 'event', event: type });
        }
      };
      target.addEventListener(type, wrapped, listenerOptions);
      const off = (): void => target.removeEventListener(type, wrapped, listenerOptions);
      onDispose(off);
      return off;
    };
    return {
      id,
      meta,
      app,
      graph,
      emit: (port, value, opts) => emitFrom(id, port, value, opts),
      bang: (port) => emitFrom(id, port, BANG, { replay: false }),
      lastValue: (port) => nodes.get(id)?.lastValues.get(port),
      onDispose,
      onFrame: (cb) => {
        const off = app.onFrame((time, dt, frame) => {
          try {
            cb(time, dt, frame);
          } catch (e) {
            app.reportError(e, { graph: name, node: id, phase: 'frame' });
          }
        });
        onDispose(off);
        return off;
      },
      listen: listen as Listen,
      error: (err) => app.reportError(err, { graph: name, node: id }),
      attachments,
      attachment: (attachmentName) => findAttachment(id, attachments, attachmentName),
    };
  }

  function startNode(node: NodeRecord): void {
    if (node.started || !node.instance) return;
    node.started = true;
    const start = node.instance.start;
    if (typeof start !== 'function') return;
    try {
      watchAsync((start as () => unknown).call(node.instance), { graph: name, node: node.id, phase: 'start' });
    } catch (e) {
      app.reportError(e, { graph: name, node: node.id, phase: 'start' });
    }
  }

  const graph: Graph & { readonly [GRAPH_MARK]: true } = {
    [GRAPH_MARK]: true,
    app,
    name,

    add<In extends object = Ports, Out extends object = Ports>(id: string, factory: NodeFactory<In, Out>, meta: NodeMeta = {}): Graph {
      if (typeof id !== 'string' || id === '') throw new Error(`hlg-runtime (${name}): node id must be a non-empty string`);
      if (nodes.has(id)) throw new Error(`hlg-runtime (${name}): duplicate node id "${id}"`);
      if (typeof factory !== 'function') throw new Error(`hlg-runtime (${name}): factory for "${id}" is not a function`);
      const node: NodeRecord = { id, meta, instance: null, lastValues: new Map(), disposers: [], started: false };
      nodes.set(id, node);
      order.push(id);
      const ctx = makeContext(id, meta);
      try {
        const result: unknown = factory(ctx as unknown as NodeContext<Out>);
        if (isThenable(result)) {
          watchAsync(result, { graph: name, node: id, phase: 'create' });
          throw new Error(
            `the factory of node "${id}" returned a Promise — node factories must be synchronous: return { inputs, start, dispose } right away and ctx.emit() when async work finishes`,
          );
        }
        const instance = isGraph(result) ? wrapGraph(result, ctx) : result;
        node.instance = (instance || {}) as RuntimeInstance;
      } catch (e) {
        node.instance = {};
        app.reportError(e, { graph: name, node: id, phase: 'create' });
      }
      const marks = factory as MarkedFactory;
      if (marks[GRAPH_INPUT] !== undefined) graphInputs.push({ id, name: marks[GRAPH_INPUT] });
      if (marks[GRAPH_OUTPUT] !== undefined) graphOutputs.push({ id, name: marks[GRAPH_OUTPUT] });
      if (started && !disposed) startNode(node);
      return graph;
    },

    connect(fromId, outPort, toId, inPort) {
      requireNode(fromId);
      const target = requireNode(toId);
      const k = key(fromId, outPort);
      const list = wires.get(k) || [];
      if (list.some((w) => w.to === toId && w.port === inPort)) return graph;
      const tk = key(toId, inPort);
      const slot = slotCounters.get(tk) || 0;
      slotCounters.set(tk, slot + 1);
      const wire: Wire = { to: toId, port: inPort, slot };
      list.push(wire);
      wires.set(k, list);
      if (!handlerFor(target, inPort)) {
        warnOnce(`h:${toId}:${inPort}`, `node "${toId}" has no input handler for "${inPort}" (wired from ${fromId}.${outPort})`);
      }
      const source = requireNode(fromId);
      if (source.lastValues.has(outPort)) {
        deliverNow(toId, inPort, source.lastValues.get(outPort), { from: fromId, port: outPort, slot, event: false });
      }
      return graph;
    },

    disconnect(fromId, outPort, toId, inPort) {
      const list = wires.get(key(fromId, outPort));
      if (!list) return false;
      const i = list.findIndex((w) => w.to === toId && w.port === inPort);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    },

    send(toId, inPort, value, opts = {}) {
      requireNode(toId);
      deliverNow(toId, inPort, value, { from: null, port: null, slot: -1, event: !!opts.event });
      return graph;
    },

    lastValue: (id, port) => nodes.get(id)?.lastValues.get(port),

    nodeIds: () => [...order],

    start() {
      if (started || disposed) return graph;
      started = true;
      for (const id of [...order]) startNode(requireNode(id));
      return graph;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      queue = [];
      for (const id of [...order].reverse()) {
        const node = requireNode(id);
        const instance = node.instance;
        if (instance && typeof instance.dispose === 'function') {
          try {
            (instance.dispose as () => void).call(instance);
          } catch (e) {
            app.reportError(e, { graph: name, node: id, phase: 'dispose' });
          }
        }
        while (node.disposers.length) {
          try {
            (node.disposers.pop() as () => void)();
          } catch (e) {
            app.reportError(e, { graph: name, node: id, phase: 'dispose' });
          }
        }
      }
      wires.clear();
      outputListeners.clear();
    },

    get started() {
      return started;
    },
    get disposed() {
      return disposed;
    },

    get interface() {
      return { inputs: graphInputs.map((g) => g.name), outputs: graphOutputs.map((g) => g.name) };
    },

    input(inputName, value, info = {}) {
      let n = 0;
      for (const gi of graphInputs) {
        if (gi.name !== inputName) continue;
        n++;
        deliverNow(gi.id, inputName, value, { from: null, port: null, slot: -1, event: !!info.event });
      }
      return n;
    },

    onOutput(cb) {
      outputListeners.add(cb);
      for (const [outName, [value, info]] of lastOutputs) cb(outName, value, info);
      return () => {
        outputListeners.delete(cb);
      };
    },

    _output(outName, value, info) {
      if (!info.event) lastOutputs.set(outName, [value, info]);
      for (const cb of [...outputListeners]) cb(outName, value, info);
    },
  };
  return graph;
}

/** Name key for attachment lookups: trimmed, Unicode-normalized, lower-case. */
function attachmentKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

/**
 * Validates and freezes `meta.attachments` once per node. Problems are reported (never thrown) so one
 * malformed entry cannot take the node down: a non-list, entries without a name / url, duplicate names
 * (the first wins), reference attachments (never shipped — left out) and absolute URLs (kept, but they
 * break under /preview/<id>/).
 */
function readAttachments(id: string, meta: NodeMeta, report: (error: Error) => void): readonly NodeAttachment[] {
  const raw: unknown = ownField(meta, 'attachments');
  if (raw === undefined || raw === null) return Object.freeze([]);
  if (!Array.isArray(raw)) {
    report(new Error(`attachments of node "${id}" must be a list of { name, url, mime, role } (g.add meta)`));
    return Object.freeze([]);
  }
  const out: NodeAttachment[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const record = entry !== null && typeof entry === 'object' ? entry : null;
    const name = ownField(record, 'name');
    const entryName = typeof name === 'string' ? name : '';
    const rawUrl = ownField(record, 'url');
    const url = typeof rawUrl === 'string' ? rawUrl : '';
    if (!record || entryName.trim() === '' || url === '') {
      report(new Error(`attachment #${index} of node "${id}" needs a name and a url (g.add meta)`));
      return;
    }
    const role = ownField(record, 'role');
    if (role !== undefined && role !== 'embed') {
      report(new Error(`attachment "${entryName}" of node "${id}" is a ${String(role)} attachment — only embed attachments are shipped with the app`));
      return;
    }
    const key = attachmentKey(entryName);
    if (seen.has(key)) {
      report(new Error(`duplicate attachment name "${entryName}" on node "${id}" (names are unique per node, ignoring case) — the first one is used`));
      return;
    }
    seen.add(key);
    if (url.startsWith('/') || url.startsWith('\\')) {
      report(new Error(`the url of attachment "${entryName}" of node "${id}" must be relative (the app runs under /preview/<id>/): "${url}" — use "assets/${id}/<file>"`));
    }
    const mime = ownField(record, 'mime');
    out.push(Object.freeze({ name: entryName, url, mime: typeof mime === 'string' ? mime : '', role: 'embed' as const }));
  });
  return Object.freeze(out);
}

/** An object's OWN field (never one inherited from a polluted `Object.prototype`); undefined otherwise. */
function ownField(value: object | null, key: string): unknown {
  return value !== null && Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

/** `ctx.attachment(name)`: exact name first, then ignoring case / spaces / Unicode normalization. */
function findAttachment(id: string, attachments: readonly NodeAttachment[], name: string): string {
  const wanted = String(name);
  const exact = attachments.find((a) => a.name === wanted);
  if (exact) return exact.url;
  const key = attachmentKey(wanted);
  const loose = attachments.find((a) => attachmentKey(a.name) === key);
  if (loose) return loose.url;
  if (attachments.length === 0) {
    throw new Error(
      `node "${id}" has no attachments, so ctx.attachment("${wanted}") has nothing to return — copy the embedded file to app/public/assets/${id}/ and list it in the node's g.add meta: attachments: [{ name, url, mime, role: 'embed' }]`,
    );
  }
  throw new Error(`node "${id}" has no attachment "${wanted}" — its attachments: ${attachments.map((a) => `"${a.name}"`).join(', ')}`);
}

function isGraph(value: unknown): value is Graph {
  return !!value && typeof value === 'object' && (value as { [GRAPH_MARK]?: unknown })[GRAPH_MARK] === true;
}

/** Turn an inner graph into a node instance of the parent (inputs → graph inputs, outputs → emits). */
function wrapGraph(inner: Graph, ctx: NodeContext): NodeInstance {
  const off = inner.onOutput((outName, value, info) => ctx.emit(outName, value, { replay: !info.event }));
  const inputs: InputHandlers = {};
  for (const inName of inner.interface.inputs) {
    inputs[inName] = (value, info) => {
      inner.input(inName, value, info || {});
    };
  }
  return {
    inputs,
    start: () => {
      inner.start();
    },
    dispose: () => {
      off();
      inner.dispose();
    },
  };
}

/**
 * Explicitly wrap a graph factory `({ app }) => graph` as a node factory. (Graph factories also
 * work directly in graph.add(); this wrapper just makes the intent obvious in generated wiring.)
 */
export function subgraph(graphFactory: GraphFactory): NodeFactory {
  return (ctx) => {
    const inner: unknown = graphFactory(ctx);
    if (!isGraph(inner)) throw new Error('subgraph(): the factory did not return a graph');
    return wrapGraph(inner, ctx);
  };
}

/** Node factory for a `graph-input` node: values fed to the graph's input `name` leave on port `name`. */
export function graphInput(portName = 'in'): NodeFactory {
  const factory: NodeFactory & MarkedFactory = (ctx) => ({
    inputs: { [portName]: (value: unknown, info: Partial<DeliveryInfo> = {}) => ctx.emit(portName, value, { replay: !info.event }) },
  });
  factory[GRAPH_INPUT] = portName;
  return factory;
}

/** Node factory for a `graph-output` node: values arriving on input `name` become the graph's output `name`. */
export function graphOutput(portName = 'out'): NodeFactory {
  const factory: NodeFactory & MarkedFactory = (ctx) => ({
    inputs: { [portName]: (value: unknown, info: Partial<DeliveryInfo> = {}) => ctx.graph._output(portName, value, info) },
  });
  factory[GRAPH_OUTPUT] = portName;
  return factory;
}
