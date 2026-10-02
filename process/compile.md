# Compile procedure

Follow this for every `compile` event. The event gives you:

| field | meaning |
|---|---|
| `compileId` | the compile id `<id>` (a timestamp, e.g. `20260928-181500`) |
| `graph` | the graph to compile (e.g. `main`, `examples/synth`) — the **entry graph** |
| `paths` | `root`, `input`, `app`, `build`, `latest`, `plan`, `log` — project-relative paths for this compile |
| `diagnostics` | validator results on the snapshot (errors/warnings the UI already shows) |
| `previous` | id of the successful compile this one builds on, if any — the one of the same graph that finished last, else the one of any graph that finished last — for incremental reuse |
| `seededFrom` | set when `app/` is **pre-seeded**: halugraph already copied that compile's `app/` (always `previous`) into `paths.app` — update it in place (Steps 6–7). Absent → `app/` does not exist yet |
| `previewUrl` | where the build will be served: `/preview/<id>/` (and `/preview/latest/` once done) — a path on the preview origin (`previewBaseUrl`, e.g. `http://127.0.0.1:4748/preview/`) |

Below, `<id>` is `compileId`, `<graph>` is `graph`, `<prev>` is `previous`.

The generated app is **TypeScript** (strict), built by Vite. Every command below runs from the
**project root** in a POSIX shell (bash/zsh; on Windows, Git Bash — Claude Code's Bash tool, not its
PowerShell tool — provides `mkdir`, `cp`, `diff`, `tee`, `tail`, `grep` and `ls`).

**With halugraph's MCP tools** (AGENTS.md §13), a single `tools/cmd/halugraph-client <command>` step is
its tool — `compile start <id>` → `compile_start {"id": "<id>"}`, `error … --compile <id>` →
`report_error {…, "compile_id": "<id>"}`, `graph <graph> --resolved --compile <id>` → `get_graph`
(table: `tools/doc/halugraph-mcp.md`). Commands that pipe the client into `node` stay as written.

---

## 1. Folder conventions

```
agents/compiles/<id>/input/        snapshot of .hlg, graphs/, nodes/ and the attached files in assets/
                                   (made by halugraph) — READ ONLY
agents/compiles/<id>/compile.json  compile record (halugraph) — do not edit
agents/compiles/<id>/plan.md       yours: interpretation, node → module map, assumptions, questions
agents/compiles/<id>/app/          yours: the Vite + TypeScript project (from process/templates/vite-app,
                                   or pre-seeded by halugraph with the previous compile's app — seededFrom)
    index.html  vite.config.ts  tsconfig.json  package.json
    src/main.ts                    bootstraps the entry graph, mounts the page
    src/hlg-runtime.ts             the typed dataflow runtime (copied verbatim from the template)
    src/vite-env.d.ts              Vite's client types (import.meta.hot, asset imports)
    src/style.css                  default styles (hlg-* classes), extended per app
    src/graphs/<graph>.ts          wiring for each graph (entry + subgraphs; subgraphs are factories)
    src/nodes/<graph>/<nodeId>.ts  ONE MODULE PER GRAPH NODE — the "node source code"
    src/lib/…                      optional helpers shared by several node modules (.ts)
    src/assets/…                   optional bundled files (images, samples, fonts)
    public/assets/<nodeId>/<file>  the nodes' embedded attachments (Step 7), shipped as they are
agents/compiles/<id>/build.log     build output (tee'd by the build command)
agents/compiles/build/<id>/        vite build output (index.html + assets/) — built with --base ./
agents/compiles/build/latest/      copied by halugraph on `compile done` — never touch
agents/compiles/node_modules/      the shared toolchain (vite + typescript + extra libraries), installed once
```

In project-relative terms the generated code lives at `agents/compiles/<id>/app/src/nodes/<graph>/<nodeId>.ts`
(written below as `app/src/nodes/<graph>/<nodeId>.ts`) and `app/src/graphs/<graph>.ts`. Graph names
with slashes become folders: node `osc` of graph `examples/lib/voice` →
`app/src/nodes/examples/lib/voice/osc.ts`, its wiring → `app/src/graphs/examples/lib/voice.ts`.

**`app/src/graphs/` and `app/src/nodes/` contain exactly the graphs of this compile** (the entry graph
and its subgraphs) — nothing from other graphs, nothing from the template's reference example.

---

## 2. Step by step

Report progress after each step with `compile progress` (the fractions are a guide).

### Step 1 — Start

```bash
tools/cmd/halugraph-client status agent "Compiling <graph>…" --state busy
tools/cmd/halugraph-client compile start <id>
tools/cmd/halugraph-client events
tools/cmd/halugraph-client errors clear
```

`events` shows what is queued behind this compile without consuming it. If it lists a `cancel` whose
`compileId` is `<id>` — or `compile start` was refused because the compile is cancelled — the user
cancelled this compile while it was waiting for you: stop here (§5).

### Step 2 — Read the snapshot

```bash
tools/cmd/halugraph-client graph <graph> --resolved --compile <id>
tools/cmd/halugraph-client compile progress <id> "Reading the graph" --progress 0.05
```

The resolved graph has every node with its `definition` (the node type from `nodes/`, or the inline
definition of a `freeform` node), the `edges`, the graph `interface`, its `dependencies`, the
validator `diagnostics` and — under `subgraphs` — every transitive subgraph, resolved the same way.

- **Wire order.** Each node keeps its `inputs`/`outputs` with their `connection` lists. Fan-in order
  (`output.content`, `ui/layout.children`, `ui/panel.children`, `graphics/shader.params`) is the
  order of that input port's `connection` list — the same order as in the YAML file.
- **`edges`** hold only wires that resolve; a link to a missing node or port (validator
  `dangling-link`) is not a wire — ignore it and review it (Step 3).
- **`definition: null`** means the node's type file does not exist (validator `unknown-type`). Compile
  it from its action alone when that is clear, otherwise stub it; either way review it (Step 3).
- **Custom ports** (`"custom": true` on a port) are inputs / outputs the artist added to this one node
  beyond its type's default ports (the `+` on the canvas). Implement each one from its **name**, its
  **`description`** and the node's **action** — exactly like a default port: typed in the module's
  `Inputs` / `Outputs` (§4.4), handled or emitted, following the port data conventions (§6). The
  node type's `definition` does not mention them; the description is the artist's specification. A
  custom port whose purpose neither its description nor the action explains → pick the most sensible
  reading, record it in `plan.md` and report it as `info` (Step 3). On a `subgraph` node, ports mirror
  the called graph's graph-input / graph-output nodes; they are only custom when the two drifted.
- **Attachments** (`attachments` on a node) are files the artist attached to that node: each has a
  `name`, a `role`, a `mime` type, usually a `description`, and facts (`size`; `width`/`height` of
  pictures; `duration` in seconds of sounds and videos). `file` is project-relative
  (`assets/<hash>-<name>`); in the snapshot it is `agents/compiles/<id>/input/<file>`.
  - **`reference`** — guidance, part of the node's action; never shipped. **Open every image, sketch
    (`*.sketch.png`) and PDF with your Read tool** (path `agents/compiles/<id>/input/<file>`; with the MCP
    tools, `get_attachment {"file": "<file>", "compile_id": "<id>"}` shows you a picture directly) and treat
    what you see as part of the action: layout, proportions, colours, labels, mood. A reference on
    the `output` node is the design of the whole page. An SVG reaches you as XML text — read the
    shapes, text and colours from it. You cannot hear audio or watch video: use the `description`
    and the facts (`duration`); when such a reference decides the result and has no description,
    `ask` the user what it should sound or look like (Step 3). Where a picture and the action
    disagree, the action wins — say so in `plan.md`.
  - **`embed`** — content the app ships and the node's module uses at run time (the sample of a
    `media/audio`, the picture of a `media/image`, the CSV of a `data/csv`, a shader texture). Step 7
    copies it into the app; the module reads its URL with `ctx.attachment('<name>')` (§4.1).
  - Attachments on a `comment` are references for the whole graph — read them too.

Also read:

- `agents/compiles/<id>/input/.hlg` — project name and description (the app's overall intent);
- `comment` nodes — they carry the artist's intent;
- `agents/memory.md` — the user's preferences apply to every compile.

### Step 3 — Review

Sanity-check the graph with `process/review.md`. Report every finding with
`tools/cmd/halugraph-client error … --compile <id>` and the location flags. Fatal problems (the app
cannot be built sensibly): `ask` the user if one answer unblocks you, otherwise fail (Step 12).

```bash
tools/cmd/halugraph-client compile progress <id> "Reviewing the graph" --progress 0.15
```

### Step 4 — Plan

Write `agents/compiles/<id>/plan.md` (template in §3): your reading of the app, one line per node
(module path + interpretation), how you read every reference attachment and where each embedded one
goes, assumptions, questions, reuse decisions. It is the artist-readable
record of what you built and why — keep it honest and short.

```bash
tools/cmd/halugraph-client compile progress <id> "Planning" --progress 0.25
```

### Step 5 — Toolchain (once per project)

The shared toolchain is `agents/compiles/package.json` (Vite + TypeScript). If
`agents/compiles/node_modules/vite/bin/vite.js` or `agents/compiles/node_modules/typescript/bin/tsc`
does not exist:

```bash
npm install --prefix agents/compiles        # installs agents/compiles/package.json into agents/compiles/node_modules
```

(A project created before apps were TypeScript has no `typescript` in that package.json: add it with
`npm install --prefix agents/compiles --save-dev typescript@^7.0.2`.)

Libraries your modules import (e.g. `three` for graphics/scene-3d) are installed into the same shared
toolchain — never loaded from a CDN. Install the library's **types** too when it does not ship its
own (the type check fails with `TS7016` otherwise):

```bash
npm install --prefix agents/compiles three @types/three
```

Vite and TypeScript resolve bare imports by walking up the directory tree, so `app/` needs no
`node_modules` of its own. Also list extra libraries under `dependencies` in `app/package.json` so
the app documents them. If `npm install` fails (offline, registry error): report it with
`error --compile <id>`, and fail the compile with a clear summary.

### Step 6 — Incremental reuse (when `previous` is set)

Skip this step (every module is `new`) when `previous` is not set, or when the folder
`agents/compiles/<prev>/` no longer exists (the user may delete old compiles). Otherwise find what
changed since the last successful compile:

```bash
diff -rq agents/compiles/<prev>/input agents/compiles/<id>/input
diff -r  agents/compiles/<prev>/input/graphs agents/compiles/<id>/input/graphs
```

A node's module `agents/compiles/<prev>/app/src/nodes/<graph>/<nodeId>.ts` is **reusable** when all
of these are unchanged: the node's `type`, `action`, freeform fields, its ports (names and
descriptions — a custom port is specified by its description) and their connections (for the output node also the content order), its
`attachments` (`file`, `name`, `role`, `description` — files are content-addressed, so a changed
picture, sketch or sound has a new `file` path and the node counts as changed), and its type
definition file in `input/nodes/` (`diff -r` above lists changed node types). Layout-only changes (`position`, `size`,
`label`) do not matter. Also check `agents/compiles/<prev>/plan.md` — an assumption you made there
that the user has since contradicted forces a rewrite. When `previous` compiled a different graph,
only its subgraph modules can match. A previous compile with `.js` modules (made before apps were
TypeScript) has nothing reusable: regenerate every module.

**With `seededFrom`** (it is always `<prev>`): halugraph already copied `agents/compiles/<prev>/app/`
into `agents/compiles/<id>/app/` before the event reached you — sources, config, lockfiles,
`app/node_modules/` and the Vite / TypeScript caches, not `dist/` or logs. The reusable modules are
**already in place: keep them** (no `cp`). Rewrite the changed ones where they are (Step 7) and delete
the modules of nodes and graphs that no longer exist (Step 7, "seeded"). If `agents/compiles/<prev>/`
was deleted after the copy (nothing to diff against), treat every module as `regenerated`: rewrite it in
place — the stale-file command still cleans up.

Record the decision per node in `plan.md` (`reused` / `regenerated` / `new`), and write `plan.md` fresh
for this compile (the previous compile's `plan.md` is not copied). Everything else is generated in
Step 7. Reused modules still go through the type check (Step 8).

### Step 7 — Generate the app

**Not seeded** (the event has no `seededFrom`: there is no previous app, or copying it failed — then
the event's `diagnostics` hold a `seed-copy-failed` warning and `app/` does not exist):

1. Copy the template **without** its reference example (`src/graphs/`, `src/nodes/`):

   ```bash
   mkdir -p agents/compiles/<id>/app/src
   cp process/templates/vite-app/index.html process/templates/vite-app/package.json process/templates/vite-app/tsconfig.json process/templates/vite-app/vite.config.ts agents/compiles/<id>/app/
   cp process/templates/vite-app/src/main.ts process/templates/vite-app/src/style.css process/templates/vite-app/src/hlg-runtime.ts process/templates/vite-app/src/vite-env.d.ts agents/compiles/<id>/app/src/
   ```

2. Copy the reusable modules from Step 6 (create folders first), and helpers/assets they need:

   ```bash
   mkdir -p agents/compiles/<id>/app/src/nodes/<graph>
   cp agents/compiles/<prev>/app/src/nodes/<graph>/<nodeId>.ts agents/compiles/<id>/app/src/nodes/<graph>/
   ```

**Seeded** (`seededFrom` is set): `app/` already holds the previous app. **Do not copy the template
over it** — that would throw away its title, styles and dependencies.

1. Delete what this compile no longer has: the modules and wiring files of nodes that were removed and
   of graphs that are no longer part of this compile (e.g. the entry graph of a previous compile of
   another graph), and embedded files no node embeds any more. This command reads the resolved
   snapshot and deletes — and prints — every file under `app/src/nodes/`, `app/src/graphs/` and
   `app/public/assets/` that no node or graph of this compile owns, then removes the folders it left
   empty:

   ```bash
   tools/cmd/halugraph-client graph <graph> --resolved --compile <id> | node -e 'const fs=require("fs"),app=process.argv[1],g=JSON.parse(fs.readFileSync(0,"utf8")),keep=new Set();let n=0;for(const x of [g,...Object.values(g.subgraphs||{})]){keep.add("src/graphs/"+x.name+".ts");for(const v of x.nodes)if(!["comment","graph-input","graph-output","subgraph"].includes(v.type)){keep.add("src/nodes/"+x.name+"/"+v.id+".ts");for(const a of v.attachments||[])if(a.role==="embed")keep.add("public/assets/"+v.id+"/"+a.file.split("/").pop())}}const sweep=d=>{if(!fs.existsSync(app+"/"+d))return;for(const e of fs.readdirSync(app+"/"+d,{withFileTypes:true})){const f=d+"/"+e.name;if(e.isDirectory())sweep(f);else if(!keep.has(f)){fs.rmSync(app+"/"+f);n++;console.log("deleted "+app+"/"+f)}}if(d.split("/").length>2&&fs.readdirSync(app+"/"+d).length===0)fs.rmdirSync(app+"/"+d)};sweep("src/nodes");sweep("src/graphs");sweep("public/assets");console.log(n+" stale file(s) deleted")' agents/compiles/<id>/app
   ```

   It keeps `src/nodes/<graph>/<nodeId>.ts` for every node except `comment`, `graph-input`,
   `graph-output` and `subgraph` ones (they have no module, §4.1), `src/graphs/<graph>.ts` for the
   entry graph and every subgraph, and `public/assets/<nodeId>/<file name>` for every `embed`
   attachment of those nodes (a replaced sound or picture has a new file name, so the old file goes);
   old `.js` modules are deleted too. `public/assets/` belongs to embedded attachments only — put
   other files elsewhere. `src/lib/` and `src/assets/` are
   not touched: remove helpers that nothing imports any more yourself. If the command fails
   (`halugraph-client` exits non-zero, or node prints a JSON error), nothing was deleted — fix the
   cause and run it again.

2. Refresh the template files only when the template changed. Compare the runtime versions:

   ```bash
   grep -h "HLG_RUNTIME_VERSION =" process/templates/vite-app/src/hlg-runtime.ts agents/compiles/<id>/app/src/hlg-runtime.ts
   ```

   Two identical lines → the app is up to date: keep every file. Two different lines (or just one:
   the seeded app has no `src/hlg-runtime.ts`) → copy the four template files again (`main.ts` is then
   the template's: item 4 below adapts it):

   ```bash
   cp process/templates/vite-app/tsconfig.json agents/compiles/<id>/app/
   cp process/templates/vite-app/src/main.ts process/templates/vite-app/src/hlg-runtime.ts process/templates/vite-app/src/vite-env.d.ts agents/compiles/<id>/app/src/
   ```

   A seeded app from before apps were TypeScript (it has no `src/hlg-runtime.ts`) has nothing reusable: copy the whole template over it with the two `cp` lines of "Not seeded" item 1
   (item 1 above already deleted its `.js` modules).

**Then, seeded or not:**

3. Copy the embedded attachments. For every `embed` attachment of every node that gets a module — also
   the ones already there in a seeded app (copying the same content again is harmless) — run, with
   `<nodeId>` the node's id and `<file>` the attachment's `file` (e.g. `assets/7d2e3c5b90a1f4e6-chime.wav`):

   ```bash
   mkdir -p agents/compiles/<id>/app/public/assets/<nodeId>
   cp agents/compiles/<id>/input/<file> agents/compiles/<id>/app/public/assets/<nodeId>/
   ```

   The file keeps its name (`<file name>` = `<file>` without `assets/`; names are content-addressed and
   contain no spaces or quotes, so no quoting is needed). Vite ships `public/` as it is: the build
   has it at `assets/<nodeId>/<file name>`. The node's `g.add` meta lists it (§4.2) and its module reads
   it with `ctx.attachment('<name>')` (§4.1). Never copy `reference` attachments into the app. An embed
   whose file is not in the snapshot (`cp` fails; the event's `diagnostics` hold `missing-attachment`) is
   left out of the meta: build the node without it, as `process/review.md` says.
4. Write one module per node that needs one (§4) — seeded: only the new and changed ones, the reused
   modules stay as they are — then one wiring file per graph (entry + every subgraph; seeded too, always
   rewritten: it carries every wire and each node's meta, e.g. the new URL of a replaced embed), then update
   `src/main.ts` (the `entry` import and the app `name`) and `index.html`'s `<title>`.
5. Style: extend `src/style.css` for this app's look (the output node's action is the design brief,
   its reference attachments show it); prefer the CSS variables at the top of the file.

Progress: `compile progress <id> "Generating node modules (4/9)" --progress 0.5` — update every few
modules on large graphs.

Peek at the queue now and then (`tools/cmd/halugraph-client events`): a queued `cancel` for this
compile means stop immediately (§5).

### Step 8 — Type-check

Vite does not check types, so run the TypeScript compiler first. The type-check command, as run from
inside `agents/compiles/<id>/app`:

```
node ../../node_modules/typescript/bin/tsc --noEmit -p .
```

**Run it from the project root instead — do not `cd`** (your shell keeps its working directory
between commands, and every other command here is relative to the project root). Same check,
project-relative file names in the errors:

```bash
node agents/compiles/node_modules/typescript/bin/tsc --noEmit -p agents/compiles/<id>/app
tools/cmd/halugraph-client compile progress <id> "Type-checking" --progress 0.7
```

No output and exit code `0` means the app type-checks. Otherwise every error is one line
`<file>(<line>,<column>): error TS<code>: <message>` — **fix all of them before building** (Step 10),
then run the check again.

### Step 9 — Build

The build command, as run from inside `agents/compiles/<id>/app`:

```
node ../../node_modules/vite/bin/vite.js build --outDir ../../build/<id> --emptyOutDir --base ./ 2>&1 | tee ../build.log
```

Run it from the project root as well. This is the same build: the app folder is passed as Vite's
root, `vite.config.ts` is loaded from it, and `--outDir` stays relative to it:

```bash
node agents/compiles/node_modules/vite/bin/vite.js build agents/compiles/<id>/app --outDir ../../build/<id> --emptyOutDir --base ./ 2>&1 | tee agents/compiles/<id>/build.log
tools/cmd/halugraph-client compile progress <id> "Building" --progress 0.8
```

**The pipe hides Vite's exit status** (it is always 0), and after a failed rebuild the
`index.html` of an earlier attempt is still in `build/<id>/`. Judge success by the log — a good build
ends with `✓ built in …`:

```bash
tail -n 5 agents/compiles/<id>/build.log
```

A failed build prints `✗ Build failed in …`, `error during build:` and the error (message, file,
line) — followed by a long stack trace, so the last lines of the log never show the error. Read it
without the stack frames:

```bash
grep -v '^    at ' agents/compiles/<id>/build.log
```

### Step 10 — Fix type and build errors

Read the error (code, file, line, message), fix the module, and run Step 8 (and then Step 9) again.
Fix the cause — never silence the checker with `any`, `as any`, `@ts-ignore` or `@ts-nocheck`
(§4.4). Common type-check errors:

| tsc says | fix |
|---|---|
| `TS1005: '…' expected` | syntax error at the shown position (a reserved word as a function name? see §4.3) |
| `TS2307: Cannot find module './…'` | wrong relative path — count the `../` from the importing file (§4.2); keep the `.ts` extension |
| `TS2307: Cannot find module 'three'` | the library is not installed: `npm install --prefix agents/compiles three @types/three` |
| `TS7016: Could not find a declaration file for module '…'` | install its `@types/…` package; if none exists, add `src/lib/<lib>.d.ts` with `declare module '<lib>';` and note it in plan.md |
| `TS1484: '…' is a type and must be imported using a type-only import` | `import { h, type NodeContext } from '…'` |
| `TS2724: … has no exported member named '…'` | a typo in an import from the runtime (the message suggests the right name) |
| `TS7006: Parameter '…' implicitly has an 'any' type` | give the parameter a type (factories: `ctx: NodeContext<Outputs>`) |
| `TS18047: '…' is possibly 'null'` | check it (`if (!canvas) …`) — `querySelector`, `getContext('2d')` can return null |
| `TS2345` / `TS2322: … is not assignable to …` | a value of the wrong type: emit what the `Outputs` type says, coerce inputs (`toNumber(v)`), or correct the type |
| `TS2345` with `Float32Array<ArrayBufferLike>` … `Float32Array<ArrayBuffer>` (or `Uint8Array…`) | a Web Audio / canvas call wants an array it owns: pass a copy (`new Float32Array(v)`) or your own array, not the one you received |
| `TS2339: Property '…' does not exist on type '…'` | a typo, or the value is wider than you think: narrow it (`instanceof`, `typeof`), use the element you created instead of `event.target`. On type `'Window & typeof globalThis'` (`SpeechRecognition`, `webkitSpeechRecognition`): an API missing from TypeScript's DOM types — declare it (§4.4) |
| `TS2353` / `TS2561: Object literal may only specify known properties` | an input handler for a port missing from `Inputs` (TS2561: probably a typo — it suggests the name) — fix the name or add the port to the type |

The build rarely fails once the type check passes; when it does:

| log says | fix |
|---|---|
| `[UNRESOLVED_IMPORT] Could not resolve './…'` | wrong relative path — count the `../` from the importing file (§4.2) |
| `failed to resolve import "three"` (a bare package) | `npm install --prefix agents/compiles three` |
| `[MISSING_EXPORT] "x" is not exported by …` | the import name does not match the module's exports (node and graph modules use `export default`) |
| `[builtin:vite-transform] Expected …` | syntax error at the shown line (the type check reports it first as `TS1005`) |
| `[plugin vite:css-post]` … `[lightningcss minify] Unexpected …`, or `[plugin vite:css]` … `CssSyntaxError` | invalid CSS in `style.css` (or a CSS file it imports) at the shown line |

The logs contain terminal colour codes (`[31m`…) — ignore them. Up to ~5 attempts. If it still
fails, report the last error with
`tools/cmd/halugraph-client error "<message>" --file agents/compiles/<id>/app/src/… --line <n> --compile <id>`
and fail (Step 12).

### Step 11 — Verify

```bash
ls agents/compiles/build/<id>/index.html
grep -oE '(src|href)="[^"]*"' agents/compiles/build/<id>/index.html
ls agents/compiles/build/<id>/assets/<nodeId>/
```

- The type check (Step 8) printed nothing, `agents/compiles/build/<id>/index.html` exists and the
  log shows `✓ built in`.
- Every `src`/`href` in it is relative (`./assets/…`) — the app is served from `/preview/<id>/` and
  `/preview/latest/`, never from `/`.
- Self-check against the plan: every node with behaviour has a module, every wire of the graph has a
  `g.connect(…)` line (`grep -c "g.connect(" agents/compiles/<id>/app/src/graphs/<graph>.ts`), every
  `output.content` wire is in the page.
- Every embedded attachment is in the build: the `ls … /assets/<nodeId>/` above lists its file name
  for each node with `embed` attachments (no reference attachment is there), and each is listed
  in its node's `g.add` meta.

### Step 12 — Done

Success — halugraph copies the build to `build/latest/`, shows the toast "Build <id> ready" and
reloads the Preview:

```bash
tools/cmd/halugraph-client compile done <id> --summary "Built examples/synth: 9 nodes (7 reused), 2 assumptions — see plan.md"
```

Failure — halugraph marks the compile failed and shows your summary as an error notification, so
write the summary for the artist: what failed and what they can do about it.

```bash
tools/cmd/halugraph-client compile done <id> --failed --summary "Build failed: three.js could not be installed (offline?) — see the Problems panel"
```

Do not repeat either notification. If you made assumptions the user should review, say so in one
`notify` (or a short `dialog` listing them). If `compile done` exits `2` with HTTP 400, the build
has no `index.html` yet — go back to Step 9, or finish with `--failed`.

### Step 13 — Remember, go idle, wait

1. Update `agents/memory.md`: decisions that should hold next time, the user's preferences you learned,
   lessons (a type or build error cause, a browser quirk).
2. `tools/cmd/halugraph-client status agent "Ready" --state idle`
3. `tools/cmd/halugraph-client wait` (Bash timeout 600000 ms; Codex: `wait --timeout 280`, AGENTS.md §12).

---

## 3. plan.md template

```markdown
# Compile <id> — <graph>

## Reading
<2–5 sentences: what the app is, how it behaves, how it looks — from the output node's action, the
project description and the graph.>

## Nodes
| node | type | module | interpretation | reuse |
|---|---|---|---|---|
| osc | audio/oscillator | src/nodes/examples/synth/osc.ts | saw, +5 cents detune, freq from mtof | reused |

## Attachments
| node | attachment | role | how I read / used it |
|---|---|---|---|
| app | layout sketch | reference | title on top, big round button centred, status line below; dark page (from the sketch's notes) |
| chime | chime | embed | public/assets/chime/7d2e3c5b90a1f4e6-chime.wav, played with `ctx.attachment('chime')` |

## Assumptions
- cutoff slider: logarithmic 100–8000 Hz (action says "logarithmic"; range from action)
- …

## Questions
- (asked / pending / answered — and what you did meanwhile)

## Libraries
- none (or: three@x + @types/three — graphics/scene-3d)

## Result
<filled at the end: build ok/failed, notes for next time>
```

---

## 4. The generated code

### 4.1 Node modules — `app/src/nodes/<graph>/<nodeId>.ts`

One TypeScript module per node, the file named exactly after the node id, with this header, the
node's port types, and a default-exported factory named `node_<id>` (§4.3). The runtime API is
documented in `process/templates/vite-app/README.md`; the template's `src/` holds a complete reference
compile of `graphs/examples/hello-button.yml` to imitate.

```ts
/**
 * halugraph node  osc
 * type            audio/oscillator
 * graph           examples/synth
 * action          Sawtooth oscillator, slightly detuned (+5 cents) for a fat analog feel
 *
 * Ports: in frequency (Hz), type, detune · out signal (AudioNode)   (custom ports too, marked "custom")
 * Attachments: …  (only when it has any: name, role — e.g. "chime (embed, audio/wav)")
 * Assumptions: …  (only when you made any)
 */
import { toNumber, type NodeContext, type NodeInstance } from '../../../hlg-runtime.ts';

/** Input ports: wires are not checked at run time, so values arrive as `unknown` — coerce them. */
type Inputs = { frequency: unknown; type: unknown; detune: unknown };
/** Output ports and what they carry (§6); `ctx.emit` / `ctx.bang` are checked against this. */
type Outputs = { signal: AudioNode };

const WAVES: readonly string[] = ['sine', 'square', 'sawtooth', 'triangle'];

export default function node_osc(ctx: NodeContext<Outputs>): NodeInstance<Inputs> {
  const audio = ctx.app.audioContext();
  const node = audio.createOscillator();
  node.type = 'sawtooth';
  node.detune.value = 5;
  const out = audio.createGain();
  node.connect(out);
  node.start();
  ctx.emit('signal', out);

  return {
    inputs: {
      frequency(v) {
        const hz = toNumber(v, NaN);
        if (hz > 0) node.frequency.setTargetAtTime(hz, audio.currentTime, 0.005);
      },
      type(v) {
        const wave = String(v);
        if (WAVES.includes(wave)) node.type = wave as OscillatorType;
      },
      detune(v) {
        node.detune.value = toNumber(v, 0);
      },
    },
    dispose() {
      node.stop();
      out.disconnect();
    },
  };
}
```

Rules:
- The factory runs once per node instance and must be **synchronous** (never `async` — the type
  check rejects it): create DOM/audio objects there, emit outputs, return `{ inputs, start?, dispose? }`
  right away. Async work (loading, permissions, `await ctx.app.requireUserGesture()`) goes into
  `start()` or a handler — those may be `async`; a rejection is reported in the page with the node id.
  Handlers are keyed by **port name** (quote hyphenated names: `'in-min'(v) {…}`, and in the type:
  `'in-min': unknown`). Every connected input needs a handler.
- `ctx.emit(port, value)` sends a **value** (replayed to wires connected later, so emitting at creation
  is safe). `ctx.bang(port)` / `ctx.emit(port, v, { replay: false })` sends an **event** (never replayed).
  `ctx.bang` only accepts ports typed `Bang` in `Outputs`.
- Handlers get `(value, info)`; `info.slot` is the wire index for fan-in inputs (use it to keep order),
  `info.from` the source node id, `info.event` whether it is an event.
- Use `ctx.listen(target, type, fn)`, `ctx.onFrame(fn)` and `ctx.onDispose(fn)` so everything is
  cleaned up automatically; release everything else in `dispose()`.
- Use `ctx.app` services: `audioContext()`, `requireUserGesture()`, `mount()`/`container()`,
  `state`, `storage`, `reportError()`. Report runtime problems with `ctx.error(err)` — they show in the
  page, never fail silently.
- Implement the **action** faithfully, informed by the node type definition (function / approach /
  deliverables / preconditions). The action wins when they differ; note the conflict in plan.md.
- **Embedded attachments**: `ctx.attachment('<name>')` returns the URL of the node's embedded file
  (relative to the app, e.g. `assets/chime/7d2e3c5b90a1f4e6-chime.wav`) — `new Audio(url)`,
  `img.src = url`, `video.src = url`, `await (await fetch(url)).text()`. It throws for a name the
  node's meta does not list; `ctx.attachments` lists them all (`name`, `url`, `mime`, `role`). An
  embed is the node's built-in content: a wired input (e.g. `source`) replaces it, as the node type
  says. The URL is relative to the page: hand a Worker or an AudioWorklet the absolute
  `new URL(ctx.attachment('<name>'), document.baseURI).href` (their base is the script's folder).
- Keep modules self-contained and readable: they are the "node source code" the artist may open.

Which nodes get a module:

| node type | module? | how it is wired |
|---|---|---|
| every library type, `freeform`, `output` | yes | `g.add('<id>', node_<id>, meta)` |
| `comment` | no | ignored (read it for intent) |
| `graph-input` / `graph-output` | no | `g.add('<id>', graphInput('<port>'))` / `graphOutput('<port>')` |
| `subgraph` | no | `g.add('<id>', subgraph(graph_<target>), meta)` |

### 4.2 Wiring — `app/src/graphs/<graph>.ts`

One graph factory per graph (identifier names: §4.3). Import paths are relative to the importing
file, keep the `.ts` extension, and depend on the graph's folder depth: from
`src/graphs/examples/synth.ts` the runtime is `../../hlg-runtime.ts`, the nodes are
`../../nodes/examples/synth/<id>.ts` and the subgraph `examples/lib/voice` is `./lib/voice.ts`; a
node module `src/nodes/examples/synth/osc.ts` imports the runtime as `../../../hlg-runtime.ts` (one
`../` per folder of `nodes/<graph>/`).

```ts
/**
 * halugraph graph  examples/synth
 * source           graphs/examples/synth.yml
 * description      Monophonic synth: play the on-screen keyboard, sweep the filter with a slider
 * Nodes without a module: about (comment)
 */
import { createGraph, type Graph, type GraphDeps } from '../../hlg-runtime.ts';
import node_kb from '../../nodes/examples/synth/kb.ts';
import node_osc from '../../nodes/examples/synth/osc.ts';
// …

export default function graph_examples_synth({ app }: GraphDeps): Graph {
  const g = createGraph({ app, name: 'examples/synth' });
  g.add('kb', node_kb, { type: 'ui/keyboard', action: 'Two octaves starting at C3…' });
  g.add('osc', node_osc, { type: 'audio/oscillator', action: 'Sawtooth oscillator…' });
  // …
  // wires — for fan-in inputs, in the order of the input port's connection list
  g.connect('cutoff', 'element', 'app', 'content');
  g.connect('kb', 'element', 'app', 'content');
  g.connect('kb', 'note', 'mtof', 'a');
  // …
  return g;
}
```

- Add nodes in YAML order; connect every edge exactly once (links are stored on both ends in the
  YAML — do not wire them twice).
- **A node with `embed` attachments lists them in its meta** (in the node's order), with the URL of
  the copy Step 7 made — relative, never starting with `/`:
  `g.add('chime', node_chime, { type: 'media/audio', action: '…', attachments: [{ name: 'chime', url: 'assets/chime/7d2e3c5b90a1f4e6-chime.wav', mime: 'audio/wav', role: 'embed' }] })`.
  Reference attachments are not listed (they are not in the app).
- **Subgraphs are factories.** In `src/graphs/examples/lib/voice.ts` add
  `g.add('frequency_in', graphInput('frequency'))`, `g.add('signal_out', graphOutput('signal'))`, etc.
  The caller imports it (`import graph_examples_lib_voice from './lib/voice.ts'`) and adds one
  instance per subgraph node:
  `g.add('voice1', subgraph(graph_examples_lib_voice), { type: 'subgraph', graph: 'examples/lib/voice' })`
  — each instance has its own state.
- **The output node builds the page**: it creates the root element, places `content` in wire order
  (by `info.slot`), applies `title`/`style`, mounts in `start()` (see the reference `app.ts`); a `style` object sets the theme variables (`{ accent }` →
  `--hlg-accent`) on `<html>`.

### 4.3 Identifiers

Node ids and graph names may contain `-`, `/`, or be JavaScript/TypeScript reserved words (`switch`,
`delete`, `new`, `type`) — never use them raw as identifiers. In generated code:

- a node's factory and its import are `node_<id>`, a graph's factory and its import are
  `graph_<name>`, where every character outside `A–Z a–z 0–9 _` becomes `_`
  (`osc-1` → `node_osc_1`, `switch` → `node_switch`, `examples/lib/voice` → `graph_examples_lib_voice`);
- if two names collide after that (`osc-1` and `osc_1`), append `_2`, `_3`…;
- file names and the strings passed to `g.add`/`g.connect` keep the original id (`src/nodes/main/osc-1.ts`,
  `g.add('osc-1', node_osc_1, …)`).

### 4.4 TypeScript conventions

The app is checked with `app/tsconfig.json` (strict, `noEmit`, `verbatimModuleSyntax`,
`allowImportingTsExtensions`, DOM types, `src/` only). Write code that passes it on the first try:

- **Import with the `.ts` extension, types with `type`**:
  `import { h, toNumber, type NodeContext, type NodeInstance } from '../../../hlg-runtime.ts';`
  Runtime types to know: `NodeContext<Outputs>`, `NodeInstance<Inputs>`, `NodeFactory`, `Bang`,
  `DeliveryInfo`, `Graph`, `GraphDeps`, `AppServices` (all in the vite-app README).
- **Port types.** Declare `type Inputs = { … }` with every input port typed `unknown` (the runtime
  does not check what a wire delivers — narrow or coerce: `toNumber(v)`, `typeof v === 'string'`,
  `v instanceof HTMLElement`, `isBang(v)`), and `type Outputs = { … }` with what each output carries
  (§6: `element` → the concrete element type such as `HTMLButtonElement`, audio → `AudioNode`, bangs →
  `Bang`, numbers → `number`, lists → `number[]`…). A node without outputs takes `NodeContext`, one
  without inputs returns `NodeInstance`. Custom ports (`"custom": true`) are ports like any other:
  they go into these types and get a handler / `ctx.emit` like the node type's own ports.
- **No `any`.** Never write `any`, `as any`, `@ts-ignore` or `@ts-nocheck`; use `unknown` and narrow.
  Use `as` only for facts the checker cannot know (`String(v) as OscillatorType` after checking the
  list, `event.target as HTMLInputElement`), never to hide an error. `JSON.parse(…)`,
  `response.json()` and a `MessageEvent`'s `data` are typed `any` by the DOM types — assign them to
  `unknown` at once (`const data: unknown = await response.json();`) and narrow before you emit.
- **Null checks.** `querySelector`, `getContext('2d')`, `Map.get` may return null/undefined: check
  and report (`ctx.error(…)`) instead of using `!`.
- **DOM.** `h('input', …)` returns an `HTMLInputElement`, `svg('circle', …)` an `SVGCircleElement`;
  `ctx.listen(el, 'pointermove', (e) => …)` types `e` as a `PointerEvent`, and on Web API objects too
  (`MIDIInput` `'midimessage'` → `MIDIMessageEvent`, `WebSocket` `'message'` → `MessageEvent`) — let
  inference work instead of annotating or casting events.
- **Libraries** need types: `npm install --prefix agents/compiles <lib> @types/<lib>` unless the
  library ships its own.
- **Handlers and `start`** may return anything (concise arrows are fine) and may be `async`; the
  factory itself must return synchronously.
- **Web APIs TypeScript does not know.** A few browser APIs are missing from TypeScript's DOM types —
  notably Web Speech recognition (`SpeechRecognition`, `webkitSpeechRecognition`) and other
  vendor-prefixed APIs (the type check says `TS2339 … on type 'Window & typeof globalThis'`). Declare
  the parts you use in `src/lib/<api>.d.ts` (a declaration file without imports adds to the global
  types; give your interface its own name so a future TypeScript that ships the API does not clash):

```ts
// src/lib/speech-recognition.d.ts — the parts of Web Speech recognition this app uses
interface WebSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
}
interface Window {
  SpeechRecognition?: new () => WebSpeechRecognition;
  webkitSpeechRecognition?: new () => WebSpeechRecognition;
}
```

Then `const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;` (undefined in
Firefox — show a message) and `ctx.listen(recognition, 'result', (e) => …)` types `e` as a
`SpeechRecognitionEvent` (the `on<event>` properties you declared tell `ctx.listen` the event types).

### 4.5 `src/main.ts`

Point the `entry` import at `./graphs/<graph>.ts` and set `name` to the graph name (it namespaces
storage keys). Leave the rest (error handlers, `graph.start()`, the `window.__hlg` debug handle,
hot-reload handling) as is.

---

## 5. Cancellation

If a `cancel` for this compile shows up in `tools/cmd/halugraph-client events` (or arrives at `wait`):
stop immediately, do **not** call `compile done` (the compile is already marked cancelled), leave the
folders as they are, `status agent "Ready" --state idle`, and `wait`. The `cancel` event you peeked
at still arrives at that `wait`; you have already handled it, so just `wait` again. A `cancel` for a
compile you are not working on needs nothing either.

---

## 6. Port data conventions

What flows through wires in generated apps (node type definitions say the same per port), and the
TypeScript type to give the port in `Outputs`:

| kind | value | TypeScript type | notes |
|---|---|---|---|
| number | finite `number` | `number` | coerce loosely with `toNumber(v, fallback)`; ignore NaN |
| boolean / gate | `true` / `false` | `boolean` | gates: true = note on / held |
| bang | `BANG` from hlg-runtime.ts, sent with `ctx.bang(port)` | `Bang` | an event; receivers accept any value as a trigger |
| text | a string | `string` | |
| element | a DOM element | `HTMLElement` (or the concrete type, e.g. `HTMLCanvasElement`) | the sender creates it once; the receiver (output/layout/panel) places it |
| audio | a Web Audio node on `ctx.app.audioContext()` | `AudioNode` | receivers `connect()` it; numeric audio params also accept an AudioNode (modulation) |
| image / texture | an img, canvas, video or ImageBitmap | `CanvasImageSource` | drawable with `drawImage` and uploadable with `texImage2D` |
| video | a video element | `HTMLVideoElement` | read its current frame every animation frame |
| colour | a CSS colour string (`#rrggbb`, `rgba(…)`) | `string` | receivers may also accept `{ r, g, b }` in 0..1 |
| list / rows | an array (or typed array for per-frame data) | `unknown[]`, `number[]`, `Float32Array`, `Uint8Array` | per-frame typed arrays are reused — copy to keep |
| object / JSON | plain object | `Record<string, unknown>` (or a declared type) | |
| shape | from graphics/shape | `{ kind: string; x: number; y: number; size: number; color: string; draw(g: CanvasRenderingContext2D, w: number, h: number): void }` | |
| 3D object | from graphics/mesh | `THREE.Object3D` | |
| MIDI note | integer 0–127 | `number` | convert to Hz with `mtof(note)` |

When a wire connects mismatched kinds (an AudioNode into a label, a number into `output.content`),
report it (review) and implement the most sensible conversion the action allows.

---

## 7. Browser realities (check every app against this list)

- **Audio needs a user gesture.** Browsers start the AudioContext suspended. Any app that uses
  `audio/dac`, `media/audio`, `text/speech` or microphone input must show a "click to start" overlay
  before the first sound: call `ctx.app.requireUserGesture({ text: 'Click to start the sound' })` in
  `start()` (audio/dac does it). Never assume sound plays on load.
- **Permissions.** Microphone, camera and MIDI need permission and a secure context (the preview on
  localhost is fine; its iframe allows `microphone; camera; midi; autoplay; fullscreen`). Request after
  a gesture, handle denial with a visible explanation (`hlg-message`), never a blank page.
- **Feature support.** Web Speech recognition (Chromium/Safari), Web MIDI (Chromium/Firefox), WebGL2 —
  feature-detect and show a friendly message when missing.
- **Responsive.** Works from 360 px wide phones to large screens; no horizontal scrolling; touch works
  (pointer events, `touch-action: none` on custom controls); readable in dark and light mode.
- **Self-contained — no external CDNs.** Bundle every library via `npm install --prefix agents/compiles
  <lib>`; use system fonts or bundle font files; no runtime network access unless the graph asks for it
  (data/fetch). Never embed secrets.
- **Works from a sub-path.** Served at `/preview/<id>/` and `/preview/latest/`: keep every URL relative
  (`--base ./` does this for bundled files); import assets from `src/` (`import url from
  './assets/x.png'`) or use `new URL('./assets/x.png', import.meta.url)`; embedded attachments come
  from `ctx.attachment(name)` (already relative); never write `"/assets/…"`.
- **Own origin, shared by every build.** Previews run on their own origin — the halugraph host on
  another port (e.g. `http://127.0.0.1:4748/` next to the editor's `:4747`) — so an app cannot reach
  the halugraph API or the editor's storage. All builds of this project share that preview origin and
  its `localStorage`: use `ctx.app.storage` (namespaced) instead of raw `localStorage`, never call
  `localStorage.clear()`; do not reach into `window.parent`.
- **Performance.** One animation loop (`ctx.onFrame`), no work when nothing changes, cap
  `devicePixelRatio` at 2 for canvases/WebGL, reuse typed arrays, dispose GPU/audio resources.
- **Errors are visible.** Uncaught errors show in the page (main.ts + runtime banner). Don't swallow
  exceptions; report them with `ctx.error`.
- **Accessibility.** Real `<button>`/`<input>` elements, labels, visible focus, keyboard operation.
