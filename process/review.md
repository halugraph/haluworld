# Reviewing a graph before compiling

You are the compiler: before generating code, read the graph like a compiler reads source code and
report what does not make sense — in the Problems panel, at the exact node and port, so the artist can
click and fix it. Do this in Step 3 of `process/compile.md`, and whenever the user asks you to check a
graph.

Input: `tools/cmd/halugraph-client graph <graph> --resolved --compile <id>` (definitions inlined,
subgraphs included) plus the compile event's `diagnostics` (structural problems the validator already
found — do not re-report those, but do take them into account: §2). When the user asks you to check
a graph outside a compile, read `tools/cmd/halugraph-client graph <graph> --resolved` and
`tools/cmd/halugraph-client validate --graph <graph>` instead, and report without `--compile`.

---

## 1. Checklist

Go through every node (skip `comment` nodes, but read them for intent):

1. **Action vs. type.** Does the action ask for something this node type can do (its `function`)?
   "Play a drum loop" on a `ui/label` is a mismatch; "count clicks" on a `ui/label` is a reasonable
   reinterpretation (the label keeps a count) — allowed, note it in plan.md.
2. **Preconditions.** Read the type's `preconditions` and check them against the wiring: required
   inputs connected (an `audio/envelope` without `gate`, a `math/map-range` without `value`), outputs
   that must reach something (an oscillator whose signal never reaches an `audio/dac`), elements that
   must reach the page (a `ui/slider` whose `element` is not wired into `output.content`/a layout).
3. **Unconnected inputs that matter.** An unconnected input is fine when the action or the type
   provides a default ("starts at 1200 Hz", default 440 Hz). It is a problem when the node cannot do
   its job without it.
4. **Type mismatches.** Compare what each wire carries with what the receiving port expects (port
   conventions and their TypeScript types: `process/compile.md` §6): an audio signal into
   `ui/label.text`, a number into `output.content`, a File into `data/csv.text`, a DOM element into
   `audio/dac.left`, a colour into an oscillator's `frequency`. These are graph problems — report them
   here. (TypeScript errors in the code you generate later are not: you fix those yourself in
   `process/compile.md` Step 10. Wires are not type-checked by TypeScript, so this review is the only
   check a wire gets.)
5. **Contradictions.** Two nodes (or a node and the output's action) demand incompatible things:
   "full-screen canvas" on the output but three stacked panels in `content`; a slider "0–1" feeding a
   filter whose action says "cutoff 200–8000 Hz"; `audio/delay` feedback of 1.5.
6. **Missing output.** A compiled graph needs exactly one `output` node with something wired into
   `content` (or an action that describes a page without elements, e.g. a pure audio app with a start
   button made by the output itself). No `output` node at all means there is no app to build: fail
   the compile with a summary that tells the artist to add an App (`output`) node and wire UI into its
   `content`.
7. **Impossible or unsafe requests.** Things a browser SPA cannot do (read arbitrary files from the
   disk, run for free on a server, access hardware without permission, bypass autoplay rules), or
   things you must not do (hidden tracking, embedded secrets). Report them and offer the closest
   possible behaviour.
8. **Subgraphs.** Subgraph node ports match the target's interface; the target has no `output` node;
   graph-inputs that are left unconnected in the caller get a sensible default.
9. **Global sanity.** Feedback loops (allowed — the runtime handles them — but make sure they
   converge or are intended), orphan nodes that do nothing, duplicated work.
10. **Attachments** — below.

### Attachments

Nodes may carry files (`attachments` in the resolved graph; `process/compile.md` Step 2):

- **Look at every `reference` picture, sketch and PDF** (Read tool, `agents/compiles/<id>/input/<file>`)
  and compare it with the graph. A sketch that shows three buttons while the graph wires one, or a
  mock-up in light colours on an App whose action says "dark" → `warning`, code `contradiction`: build
  what the graph wires and the action says, laid out like the picture, and say so in `plan.md`.
- **A reference sound or video with no description** — you cannot hear or watch it. When it decides
  the result (the only hint of what a synth should sound like), `ask` the user; otherwise note it as
  `info`, code `undescribed-attachment`, and go by the action.
- **An `embed` the node does not use** — e.g. a picture on a `ui/button` whose action never mentions
  it: `info`, code `suggestion` (ship it only when the action or the type says how it is used).
- **A wired input next to an embed** (`source` wired on a `media/audio` that also embeds a sound):
  the embed is the initial content and the wire replaces it — fine; say so in `plan.md`.
- **Large embeds** (`size` over ~10 MB) make the app slow to load: `info`, code `suggestion`.

```bash
tools/cmd/halugraph-client error "The layout sketch shows a volume slider, but the graph has none — built the page without it. Add a ui/slider if you want one." --severity warning --code contradiction --graph examples/sketch-to-app --node app --compile 20260928-181500
```

---

## 2. Findings the validator already reported

The compile event's `diagnostics` (and the resolved graph's `diagnostics`) come from halugraph's
validator; the artist already sees them in the Problems panel. **Do not report them again** — decide
what they mean for the build, record that in `plan.md`, and report only what you did about it when
that adds information. Validator errors do not stop a compile by themselves:

| validator code | what you see in the resolved graph | what you do |
|---|---|---|
| `unknown-type`, `missing-type` | the node has `definition: null` | build it from its action when the action is clear (`--severity warning --code assumption`), otherwise stub it with a visible message |
| `dangling-link`, `malformed-link`, `wrong-direction` | the link is not in `edges` | no wire; treat the port as unconnected (checklist item 3) |
| `asymmetric-link` | the wire is in `edges` | wire it once, as usual |
| `subgraph-unknown-graph`, `subgraph-missing-graph`, `subgraph-recursion` | the call cannot be built (no target in `subgraphs`, or it would call itself forever) | stub the node with a visible message; fail the compile only when the app depends on it |
| `subgraph-port-mismatch` | the node's ports differ from the target's `interface` | wire by port name; drop ports the target lacks; unwired target inputs get defaults |
| `no-output`, `multiple-outputs`, `output-in-subgraph` | zero, several, or a nested `output` node | none → fail (checklist item 6); several → build the first one and say so in `plan.md`; inside a subgraph → ignore it (a subgraph is a part, not a page) |
| `unconnected-output-node` | `content` has no wires | fine when the App's action describes the whole page (the seeded `main` graph starts like this); otherwise build what the action allows and note it in `plan.md` |
| `duplicate-node-id`, `invalid-node-id`, `duplicate-port-name` | ambiguous wiring | the first node/port with the name wins (as in `edges`); ask or fail only when the ambiguity matters |
| `graph-port-unnamed`, `graph-port-duplicate` | odd names in `interface` | use the names in `interface` |
| `freeform-empty`, `empty-action` (info) | no text to compile from | fall back on the type definition (freeform: on the action); note the choice in `plan.md` |
| `node-type-no-function`, `node-type-duplicate-port` | a thin or odd `definition` | compile from the rest of the definition and the actions; ports are addressed by name, the first one wins |
| `invalid-name`, `missing-main` | a file name or `.hlg` problem | does not change this compile (it names its graph explicitly); leave it to the user |
| `missing-attachment` | an attachment whose file is not in the snapshot (`agents/compiles/<id>/input/<file>` does not exist) | a reference → compile from the action and its `description`; an embed → build the node without it (its empty state) and note it in `plan.md`; never invent the file |
| `attachment-role-mismatch` | an `embed` the node type does not accept (e.g. a picture on `media/audio`), or an `embed` on a node without a module (`comment`, `graph-input`, `graph-output`, `subgraph`) | treat it as a reference (look at it) unless the action says how the node uses it; note it in `plan.md` |
| `invalid-attachment-path` | nothing: an attachment whose `file` is not a file in `assets/` is not in the resolved graph (the finding names it) | compile without it; never go looking for that file (only read files inside the snapshot) |
| `duplicate-attachment-name` | two attachments of a node whose names are equal the way `ctx.attachment(name)` compares them (trimmed, same Unicode form, ignoring case) | use the first one; `ctx.attachment(name)` needs unique names |
| `unused-asset` (info, project level) | a file in `assets/` that no graph references | nothing to do for the compile; never delete it (the artist cleans up in the UI) |

---

## 3. Severity — what to do with a finding

| severity | meaning | you then… |
|---|---|---|
| `error` | this part cannot be compiled sensibly (missing required input, impossible request, incompatible types with no sensible conversion) | build the rest if you can (stub the broken part with a visible message) — or, if the whole app depends on it, `ask` (when one answer unblocks you) or fail the compile |
| `warning` | compiled, but with an assumption the user should check (reinterpreted action, converted type, default chosen for a missing value) | build it, record the assumption in `plan.md` |
| `info` | a suggestion or a note (a simpler way, an unused output, a missing caption) | build it |

Never stop the compile for warnings or infos. Prefer building something useful with clearly reported
assumptions over asking; ask only for genuinely blocking ambiguities.

Codes: short kebab-case names — `missing-input`, `unwired-output`, `type-mismatch`, `contradiction`,
`impossible`, `assumption`, `not-on-page`, `unsupported-browser-feature`, `undescribed-attachment`,
`suggestion`.

---

## 4. Exact commands

Always pass `--compile <id>` during a compile (the Problems panel groups by compile), plus as many
location flags as apply: `--graph`, `--node`, `--port` with `--side input|output`, or `--node-type`
for problems in a node type definition.

```bash
# error — an envelope without gate: the VCA it drives stays silent
tools/cmd/halugraph-client error "Envelope has no gate input — nothing opens the VCA, the synth stays silent. Wire a keyboard/sequencer gate into it." --severity error --code missing-input --graph examples/synth --node env --port gate --side input --compile 20260928-181500

# error — type mismatch
tools/cmd/halugraph-client error "An audio signal is wired into a label's text; a label cannot show sound. Use an audio/analyser and wire its level instead." --severity error --code type-mismatch --graph main --node label1 --port text --side input --compile 20260928-181500

# warning — compiled with an assumption
tools/cmd/halugraph-client error "Slider range not given; assumed 100–8000 Hz (logarithmic) because it drives a filter cutoff." --severity warning --code assumption --graph examples/synth --node cutoff --compile 20260928-181500

# warning — element not on the page
tools/cmd/halugraph-client error "The slider's element is not wired into the page, so it cannot be used. Wire element → app.content." --severity warning --code not-on-page --graph main --node slider1 --port element --side output --compile 20260928-181500

# info — suggestion
tools/cmd/halugraph-client error "The keyboard's velocity output is unused; wire it into the envelope gate to play dynamically." --severity info --code suggestion --graph examples/synth --node kb --port velocity --side output --compile 20260928-181500

# a problem in a node type definition
tools/cmd/halugraph-client error "Node type has no function text; compiled from the instance actions only." --severity warning --code node-type-no-function --node-type my/wobbler --compile 20260928-181500
```

Messages: one or two sentences, plain language, say **what is wrong, the consequence, and how to fix
it**. The artist reads them, not a programmer.

---

## 5. After the review

- Everything you decided goes into `plan.md` → "Assumptions".
- If you asked a question and it is still pending, record it in `plan.md` → "Questions" and continue
  with your best assumption.
- Fatal and unanswerable → `tools/cmd/halugraph-client compile done <id> --failed --summary "<why>"`.
