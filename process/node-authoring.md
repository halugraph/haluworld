# Authoring node types (and editing graphs) on request

`nodes/` and `graphs/` belong to the user. Edit them **only when a `message` event asks you to**
("make me a node that…", "add a delay after the filter", "fix the problems in synth"). halugraph
watches both folders: the UI reloads changed files by itself, and the user's next save (Ctrl+S)
commits them to git. Never commit yourself.

---

## 1. Node type files — `nodes/<name>.yaml`

The type name is the path relative to `nodes/` without extension (`nodes/fx/wobble.yaml` → type
`fx/wobble`). Folders group types in the Library; lowercase kebab-case names (`fx/tape-echo`).
New files use the `.yaml` extension. Keys are lowercase, in this order:

```yaml
description: Tape-style echo with wow and flutter        # one line for the Library palette
category: Audio                                          # palette group (default: folder name)
color: "#7e57c2"                                         # header colour — quoted, "#rrggbb"
icon: repeat                                             # optional Material icon name
function: |
  What role the node plays in an app, in one or two sentences.
approach: |
  How to implement it in a browser SPA: which Web APIs, the DOM structure / audio graph, how each
  input is applied, what each output emits and when, defaults, performance notes.
deliverables: |
  What the finished module provides — each output with its data type and emission timing — and
  what "done" looks like (responsive, click-free, accessible…).
preconditions: |
  What must be true for the node to work: required wiring, valid value ranges, browser features and
  permissions, and which problems to report (with severity).
inputs:                                                  # default ports for new instances
  - name: signal
    description: Audio signal in (AudioNode)
  - name: wobble
    description: Wow/flutter depth 0..1 (default 0.3)
outputs:
  - name: signal
    description: The echoed signal (AudioNode)
attachments:                                             # optional: files that make sense on instances
  accepts:
    - audio/*                                            # MIME patterns of useful embeds
  role: embed                                            # default role of a new attachment
  hint: An impulse response to echo through              # short hint in the Inspector
```

The four core fields (`function`, `approach`, `deliverables`, `preconditions`) are what the compiler
— you, in a later compile — reads. Write them **for an AI compiler targeting a browser SPA**:

- **Concrete APIs and data types.** "Web Audio `DelayNode` + feedback `GainNode`", not "delays the
  sound". State what flows through every port using the conventions in `process/compile.md` §6 (audio
  ports carry AudioNodes, element ports carry DOM elements, bang ports carry events…). Generated apps
  are TypeScript: naming the concrete types (`AudioNode`, `HTMLCanvasElement`, `Float32Array`) tells
  the compiler exactly what to declare in the module's `Outputs` type.
- **Libraries**: name the npm package and whether it needs an `@types/…` package
  (`npm install --prefix agents/compiles three @types/three`); never a CDN.
- **Defaults and ranges** for every input ("time in seconds, default 0.3, clamp 0..5").
- **Edge cases**: unwired inputs, wrong types, NaN, empty data, permissions denied, unsupported browser.
- **Definition of done**: what the user sees/hears/gets when it works.
- **Mention every port by name** somewhere in the four fields.
- Do not describe one particular use — that is what each instance's `action` is for. The type says
  what kind of node it is; the action says what this instance does.

**Default ports.** Give the ports most instances need, with short `description`s (range, default,
type). UI-ish nodes expose an `element` output (the DOM element) to be wired into `output.content` or a
`ui/layout`/`ui/panel` `children`. Port names are lowercase kebab-case and unique per side.

**Custom ports → defaults.** Artists add ports to single nodes (the `+` on the canvas); they are
*custom* ports — ports the type does not declare, marked `"custom": true` in resolved graphs, each
specified by its `description`. When the same custom port keeps coming back — on several instances of
a type, or across graphs, with the same meaning — it belongs in the type: suggest it to the user (a
`dialog`), and once they agree add it to the type's `inputs` / `outputs` with a short description, and
mention it in `approach` / `deliverables` so every future compile implements it the same way. Leave a
one-off port alone: it is what that one node needs. (The artist can do it themselves too: the port's
menu has **Add to node type defaults**.) Existing instances keep their ports; the promoted ones simply
stop being custom.

**Attachment hint.** Artists can attach files to any node (Inspector → Attachments). The optional
`attachments` key (after `outputs`; keys `accepts`, `role`, `hint`) tells halugraph what makes sense
on this type: with `role: embed`, a dropped file whose MIME type matches `accepts` (`audio/*`, exact
types like `text/csv`) becomes an **embed** — shipped in the app, read with `ctx.attachment(name)` —
and dropping such a file on empty canvas creates this type; everything else becomes a **reference**
(guidance for the compiler, never shipped). Give a hint only when the type has a natural built-in
content (a sample, a picture, a data file, a texture); then say in `approach` how the module uses an
embed (`ctx.attachment('<name>')`) and what a wired input changes, and in `preconditions` that an
embedded file can stand in for a required input. List the types the module really handles (e.g. only
the audio formats HTML audio plays). `*/*` is allowed only last, next to explicit patterns: it lets
any file be embedded without a warning but never makes this type the drop target for it.

**Category and colour.** Reuse the existing palette so the canvas stays readable:

| category | colour |
|---|---|
| UI | `#42a5f5` |
| Audio | `#7e57c2` |
| Media | `#ec407a` |
| Graphics | `#ff7043` |
| Data | `#26a69a` |
| Math | `#66bb6a` |
| Logic | `#c0ca33` |
| Time | `#8d6e63` |
| Text | `#26c6da` |
| MIDI | `#ef5350` |
| Input | `#ab47bc` |
| Core (special types) | `output` `#f9a825`, `subgraph` `#5c6bc0`, `comment` `#fff176`, `freeform` `#90a4ae`, `graph-input`/`graph-output` `#78909c` |

A new category gets a new colour that is clearly distinct from these.

**Special types** (`output`, `freeform`, `graph-input`, `graph-output`, `subgraph`, `comment`) keep
their exact names and roles; change their text only when the user asks.

### Steps

1. `tools/cmd/halugraph-client status agent "Creating node type fx/tape-echo" --state busy`
2. Look at similar types first (`tools/cmd/halugraph-client nodes`, then read a few `nodes/…yaml`) and
   match their depth and style.
3. Write the file. Changing an existing type? Keep existing port names unless asked — graphs use them;
   if you must rename a port, update every graph that uses the type (keep links symmetric, §2).
4. Check it: `tools/cmd/halugraph-client node fx/tape-echo` (parses, shows diagnostics) and
   `tools/cmd/halugraph-client validate`.
5. Tell the user what you made and how to use it:
   `tools/cmd/halugraph-client notify "New node type fx/tape-echo is in the Library (Audio). Save with Ctrl+S to keep it." --level success`
   — use a `dialog` for a longer explanation (ports, typical wiring).
6. Note the decision in `agents/memory.md`, then `status agent "Ready" --state idle` and `wait`.

---

## 2. Editing graphs — `graphs/<name>.yml`

Graph name = path relative to `graphs/` without extension. Format (every port lists its wires; this
excerpt leaves out the `app` output node and `dac1` that the links point at):

```yaml
description: Tiny synth with a frequency slider
nodes:
  - id: slider1                     # unique, letters/digits/_/-, no dots
    type: ui/slider                 # a node type name
    action: Frequency slider, 50–2000 Hz, logarithmic feel
    position: { x: 80, y: 120 }
    inputs:
      - name: min
        connection: ""              # no wire
      - name: max
        connection: ""
      - name: value
        connection: ""
    outputs:
      - name: value
        connection: osc1.frequency  # one wire: "<nodeId>.<portName>"
      - name: element
        connection: app.content
  - id: osc1
    type: audio/oscillator
    action: ""
    position: { x: 340, y: 120 }
    inputs:
      - name: frequency
        connection: slider1.value   # the SAME wire, stored on the other end too
      - name: type
        connection: ""
      - name: detune
        connection: ""
    outputs:
      - name: signal
        connection:                 # several wires → a list
          - dac1.left
          - dac1.right
```

Rules:
- **Links are symmetric**: every wire appears on the output port (pointing at `<node>.<input>`) *and*
  on the input port (pointing back at `<node>.<output>`). Adding, removing or renaming anything means
  updating both ends.
- **Write halugraph's own format**, so the user's next save does not reformat the file: node keys in
  the order `id`, `type`, `label`, `graph`, `action`, `function`, `approach`, `deliverables`,
  `preconditions`, `position`, `size`, `inputs`, `outputs`, `attachments` (leave out optional keys you do not need);
  every port has `name` and `connection` — `connection: ""` for no wire, a plain string for one wire,
  a list for several; `position: { x: 80, y: 120 }` with whole numbers; multi-line text as a `|` block;
  double-quote text that YAML could misread (`"y"`, `"on"`, `"yes"`, anything containing `: `).
  Comments are not kept (the example's `#` notes are for you only).
- Unnamed ports are addressed as `<nodeId>.#<index>` (0-based). Prefer named ports.
- `freeform` nodes carry their own definition: `function`, `approach`, `deliverables` and
  `preconditions` on the node itself (same meaning as in a node type), plus whatever ports the user
  asked for.
- **Custom ports**: any node may carry ports its type does not declare (a port entry like any other,
  after the default ports). Give each one a `description` — it is the port's specification:
  `- name: wobble` / `connection: ""` / `description: Pitch wobble depth 0..1 (from the LFO)`.
- Fan-in order matters: the order of an input's connection list is the order in the page for
  `output.content` and layout `children`.
- New nodes get the type's default ports (from `nodes/<type>.yaml`) and a meaningful `action`.
  `subgraph` nodes also need `graph: <name>` and ports matching that graph's graph-input/graph-output
  nodes. `comment` nodes have `inputs: []` and `outputs: []`; their text is the `action`.
- Layout: roughly left → right in signal-flow order, ~260 px between columns, no overlapping nodes.
- **Attachments** (after `outputs`) are files the artist attached in the UI, each with the keys
  `file`, `name`, `role`, `mime`, `description` in this order:

  ```yaml
      attachments:
        - file: assets/3f9a2c1be07d44aa-layout.sketch.png
          name: layout sketch
          role: reference
          mime: image/png
          description: Two big knobs on top, the waveform below, dark background
  ```

  You may change `name` (unique per node), `role` (`reference` | `embed`) and `description`, or move /
  copy an attachment entry to another node, when asked. Never create, write, rename or delete files
  in `assets/` (they are content-addressed: the name contains a hash of the bytes). To add a new file,
  ask the user to attach it in the Inspector (drag and drop, paste, or **Sketch…**).
- Keep the user's ids, actions and layout unless the request is about them.
- After editing: `tools/cmd/halugraph-client validate --graph <name>` — fix everything it reports
  about your change. Then tell the user what changed (and that Ctrl+S saves it).
