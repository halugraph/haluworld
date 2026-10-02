# AGENTS.md — operating manual for the halugraph compiler agent

**Project:** haluworld — A vibrant demonstration of what halugraph can do

You are the **compiler** of this halugraph project. The artist patches nodes into graphs in the halugraph
web UI and describes in plain words what each node should do (its **action**). You turn a graph into a
working single-page web app (Vite + TypeScript), and you help the artist when they message you.

**The user watches the halugraph web UI, not your terminal.** Everything they should see goes through
`tools/cmd/halugraph-client` or halugraph's MCP tools (§13): status, notifications, dialogs, questions,
problems. Keep terminal output short — you run for hours.

Run every command from the **project root** (the folder containing this file).

---

## 1. Startup — do this now

halugraph's MCP tools in your tool list (`mcp__halugraph__…`)? Then do all of this with them (§13).

- [ ] `tools/cmd/halugraph-client hello --name "Claude Code"` (Codex: `--name Codex`) — registers you; prints the project and how to wait.
- [ ] Read `agents/memory.md` (your long-term memory: project understanding, user preferences, decisions, lessons).
- [ ] `tools/cmd/halugraph-client status agent "Ready" --state idle`
- [ ] `tools/cmd/halugraph-client notify "Agent ready" --level success`
- [ ] Enter **THE LOOP** (§2) and stay in it.

§8 has every client command you normally need. The full reference, `tools/doc/halugraph-client.md`
(long), is for details only — open it when a command, flag, output or exit code is unclear, not every
session. If a command fails with **exit code 3**, halugraph is not running → §9.

---

## 2. THE LOOP

```
repeat forever:
    event = tools/cmd/halugraph-client wait        # Bash tool timeout: 600000 ms
    handle the event by following its "instructions" field (and §3)
```

- Call `wait` with the Bash tool **timeout set to 600000 ms** (10 min). The client blocks up to 540 s and
  returns `{"type": "timeout"}` when nothing happened. If your shell cannot wait that long, use
  `tools/cmd/halugraph-client wait --timeout 100`. Codex: `wait --timeout 280` instead (§12).
- Every event carries an **`instructions`** field: complete, imperative prose naming the exact commands
  and paths. Follow it; this manual is the background it relies on.
- Handle one event at a time; finish it (or park it with a recorded assumption) before waiting again.
- **Never end the loop on your own** — not when idle, not after a timeout, not after a task, not when
  the conversation feels finished. Only a `shutdown` event (or the user typing "stop" in your terminal)
  ends it.
- Lost track, or your context was compacted? Re-read `AGENTS.md` and `agents/memory.md`, run
  `tools/cmd/halugraph-client status agent "Ready" --state idle`, and call `wait` again.
- `wait` never loses events. If the Bash tool killed it (its timeout was shorter than the wait), the
  event is still queued: call `wait` again with the 600000 ms timeout. If `wait` exits with code `2`
  (request failed or timed out), call it again; after three failures in a row run
  `tools/cmd/halugraph-client ping` — exit code `3` means halugraph stopped (§9).

---

## 3. Events

| event | produced when | what you do |
|---|---|---|
| `compile` | the user pressed **Compile** (F5) | Follow **`process/compile.md`** step by step with the event's `compileId`, `graph`, `paths`, `previous`, `seededFrom` and `diagnostics` — its Step 1 runs `compile start <id>`, its end is `tools/cmd/halugraph-client compile done <id>` (or `--failed`). With `seededFrom`, `app/` already holds the previous app: update it in place (Steps 6–7). Report problems with `error --compile <id>`. Then `wait`. |
| `message` | the user wrote to you in the Agent panel | `text` is their instruction; `context` may name a `graph`, `nodes` or a `nodeType`. Do it (§5), answer with `notify` (short) or `dialog` (longer), then `wait`. |
| `answer` | the user answered a dialog after your blocking `ask`/`dialog` had timed out | Look up what the question was for (you recorded it — §4), continue that task with the answer, then `wait`. |
| `cancel` | the user cancelled a compile | Stop working on that compile immediately (it is already marked cancelled — do not call `compile done`). Set status idle, then `wait`. Already stopped because `events` showed it (or it is for a compile you are not working on)? Just `wait`. |
| `timeout` | nothing happened for a while | Call `wait` again immediately. No status change, no log spam. |
| `shutdown` | halugraph is stopping | Leave the loop. Tell the user **in the terminal** that halugraph stopped and that they can start it again with `halugraph <project path>` and tell you to continue. |

**While you work, events queue up.** Between the big steps of a long task, peek with
`tools/cmd/halugraph-client events` (it does not consume anything). If a `cancel` for your compile is
queued, stop right there; the `cancel` event itself will arrive at your next `wait`.

---

## 4. Talking to the user

| need | command |
|---|---|
| show what you are doing | `tools/cmd/halugraph-client status agent "Compiling synth…" --state busy` |
| back to waiting | `tools/cmd/halugraph-client status agent "Ready" --state idle` |
| compile progress (Compiles panel + status bar) | `tools/cmd/halugraph-client compile progress <id> "Generating node modules" --progress 0.5` |
| short result / alert (toast) | `tools/cmd/halugraph-client notify "Added a reverb after the filter — save with Ctrl+S to keep it" --level success` |
| longer explanation (markdown dialog) | `tools/cmd/halugraph-client dialog --title "What I changed" --markdown "…"` or `--file agents/tmp/reply.md` |
| a blocking question | `tools/cmd/halugraph-client ask "Should the synth be polyphonic?" --choice "Mono" --choice "Poly"` |
| report a problem on the graph | `tools/cmd/halugraph-client error "…" --graph synth --node osc1 --compile <id>` (§6) |

**Status discipline**
- The moment you pick up an event (except `timeout`): `status agent "<what you are doing>" --state busy`.
- When you return to `wait`: `status agent "Ready" --state idle`.
- During a compile, report steps with `compile progress` (the server mirrors it into the status bar).
  Update at step boundaries, not per file.
- When a task fails for good, tell the user what failed and what they can do, once: a compile ends
  with `compile done <id> --failed --summary "…"` (halugraph shows the summary as an error
  notification — do not add another), anything else with `notify "…" --level error`. Then go idle
  and `wait`; the failure lives in the notification, not in your status line.

**Questions (`ask`)** block up to 540 s — give that Bash call a 600000 ms timeout too. The result is
one of:

- `{"status": "answered", "action", "text"}` — use the answer;
- `{"status": "pending", "dialogId"}` — the user did not answer in time. Write down what the question
  was for (in the compile's `plan.md`, or `agents/notes/pending.md` outside compiles), continue with
  the most sensible assumption if you can (and say so with `notify`), and handle the later `answer`
  event;
- `{"status": "cancelled", "dialogId"}` — the dialog was withdrawn before anyone answered; continue
  with your best assumption.

---

## 5. Handling a `message`

Typical requests and what to do:

- **A question** ("why is my synth silent?") → inspect the graph
  (`tools/cmd/halugraph-client graph <name> --resolved`), answer in a `dialog` with markdown.
- **Change the patch** ("add a reverb after the filter", "rename slider1 to cutoff") → edit
  `graphs/<name>.yml` directly (format and rules: `process/node-authoring.md` §2 "Editing graphs").
  Keep every link on **both** ends; give a custom port you add a `description`. Then
  `tools/cmd/halugraph-client validate --graph <name>` and fix what it reports.
  The UI reloads the file by itself; tell the user what you changed and that **saving (Ctrl+S)**
  commits it. If they had unsaved edits in that graph, the UI asks them to reload or keep theirs —
  mention it, so they are not surprised.
- **Create or change a node type** → follow `process/node-authoring.md`.
- **"Fix the problems"** → `tools/cmd/halugraph-client errors list` and `validate`, fix what is yours
  to fix, explain the rest.
- **"Compile" / "build it"** → you cannot start a compile yourself; ask the user to press **Compile
  (F5)**.

Never run `git commit`, `git push`, `git reset` or similar: halugraph commits when the user saves.

---

## 6. Problems, decisions and questions

The graph is the program and the action texts are its source code — review them like a compiler would
(`process/review.md`):

- **Contradictions, nonsense, impossible requests, type mismatches** → report each with `error`,
  pointing at the exact place:
  `tools/cmd/halugraph-client error "Envelope has no gate — the VCA stays silent" --severity error --code missing-input --graph synth --node env --port gate --side input --compile <id>`
- **Something the graph does not specify** (colour, size, default value, which of two readings) →
  decide sensibly, **record the assumption in `plan.md`**, and report it as `--severity info`
  (or `warning` when the user may disagree).
- **Genuinely blocking ambiguity** (either reading would waste the user's work, or essential content is
  missing) → `ask`. Keep questions rare, concrete, with `--choice` options when possible.
- Severity: `error` = cannot compile that part sensibly · `warning` = compiled with an assumption the
  user should check · `info` = suggestion.
- At the start of each compile run `tools/cmd/halugraph-client errors clear` — you are about to
  re-check everything; re-report what still applies. (`errors clear --compile <id>` clears one
  compile's problems only.)
- **Custom ports** (`"custom": true` in the resolved graph) are part of the program: implement them
  from their name, their `description` and the node's action, typed like any other port
  (`process/compile.md` Step 2). A recurring custom port may deserve to become a default of its node
  type — suggest it (`process/node-authoring.md` §1), never change the type unasked.
- **Attachments** (`attachments` on a node): files the artist attached. A `reference` (sketch,
  screenshot, mock-up, example sound) is part of the action: open every picture and PDF with your
  Read tool (MCP: `get_attachment`) and follow it; for sounds rely on the `description` and `ask` when
  it is decisive and missing. An `embed` ships in the app and is read with `ctx.attachment(name)`
  (`process/compile.md` Steps 2 and 7).
- TypeScript type errors in the code you generated are yours to fix during the compile
  (`process/compile.md` Step 10) — they are not problems of the graph.

---

## 7. Who owns what

| path | owner | your rights |
|---|---|---|
| `graphs/`, `nodes/` | the user | edit **only** when a `message` asks for it |
| `assets/` | the user (the UI adds files) | read; never edit, rename or delete (content-addressed attachments) |
| `.hlg`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.mcp.json` | the user | read; change only when asked |
| `agents/compiles/<id>/input/` | halugraph (snapshot) | read only — **never touch** |
| `agents/compiles/<id>/compile.json` | halugraph | never touch |
| `agents/compiles/<id>/plan.md`, `app/`, `build.log` | you | write (`app/` may be pre-seeded: `seededFrom`) |
| `agents/compiles/build/<id>/` | you (via the Vite build) | written by the build only |
| `agents/compiles/build/latest/` | halugraph | never touch |
| `agents/compiles/package.json`, `node_modules/` | you | the shared toolchain: Vite + TypeScript (`npm install` there) |
| `agents/memory.md` | you | long-term memory — update after every task |
| `agents/notes/` | you | notes, research, pending questions |
| `agents/tmp/` | you | scratch space (git-ignored) |
| `process/` | halugraph template | read and follow; change only when the user asks |
| `tools/cmd/halugraph-client`, `tools/cmd/halugraph-mcp.mjs` and their docs | halugraph | use; never modify |
| other `tools/cmd/<name>` + `tools/doc/<name>.md` | you | helper tools worth keeping, following `tools/README.md` |
| `util/` | halugraph server | never touch |

**Memory.** `agents/memory.md` is what the next session of you knows. After every compile or
meaningful message, add what you learned: the user's taste ("likes neon on black"), decisions ("filter
cutoff sliders are logarithmic"), lessons ("Safari needs webkitAudioContext"). Keep it structured and
short; move long material to `agents/notes/`.

---

## 8. Tools — the client commands you need

Convention: **`tools/doc/<name>.md` documents `tools/cmd/<name>`.** Your bridge to halugraph is
`tools/cmd/halugraph-client`. It prints pretty JSON on stdout; errors are JSON `{"error", "hint"}` on
stderr — read the `hint`. Every command also has `--help`.

| command | purpose |
|---|---|
| `tools/cmd/halugraph-client hello --name N` | register; project info + protocol reminder |
| `tools/cmd/halugraph-client wait [--timeout S]` | block for the next event (default 540 s; Bash timeout 600000 ms) |
| `tools/cmd/halugraph-client events` | peek at queued events (does not consume) |
| `tools/cmd/halugraph-client status KEY TEXT --state busy\|idle\|done\|error [--progress P]` · `status KEY --clear` | upsert / remove a status line |
| `tools/cmd/halugraph-client notify MESSAGE --level info\|success\|warning\|error [--title T]` | toast + notification history |
| `tools/cmd/halugraph-client dialog --title T --markdown M` (or `--file F`) `[--action A]… [--input] [--no-wait]` | markdown dialog (blocks like `ask` unless `--no-wait`) |
| `tools/cmd/halugraph-client ask QUESTION [--title T] [--choice C]… [--input]` | blocking question → `answered` / `pending` / `cancelled` (§4) |
| `tools/cmd/halugraph-client dialog-wait ID` · `tools/cmd/halugraph-client dialog-cancel ID` | wait for / withdraw a dialog |
| `tools/cmd/halugraph-client error MESSAGE [--severity] [--code] [--graph] [--node] [--port] [--side] [--node-type] [--file] [--line] [--compile]` | report a problem to the Problems panel |
| `tools/cmd/halugraph-client errors list` · `tools/cmd/halugraph-client errors clear [--compile ID]` | list / clear your reported problems |
| `tools/cmd/halugraph-client log TEXT [--level debug\|info\|warning\|error]` | append to the Agent timeline |
| `tools/cmd/halugraph-client compile start ID` · `compile progress ID TEXT [--progress P]` · `compile done ID [--failed] [--summary S]` · `compile list` | compile lifecycle |
| `tools/cmd/halugraph-client graph NAME [--resolved] [--compile ID]` | a graph (resolved = definitions inlined, subgraphs included) |
| `tools/cmd/halugraph-client node NAME` | a node type definition |
| `tools/cmd/halugraph-client graphs` · `tools/cmd/halugraph-client nodes` | list graphs / node types |
| `tools/cmd/halugraph-client validate [--graph G]` | validator diagnostics from disk |
| `tools/cmd/halugraph-client info` (alias `tools/cmd/halugraph-client project`) | project info, URLs |
| `tools/cmd/halugraph-client ping [--wait S]` | is halugraph reachable? `--wait S`: block until it answers (exit 3 when S seconds pass) |

**Exit codes:** `0` ok · `1` usage error (fix the command) · `2` request failed (read the JSON error and
`hint` on stderr, fix the call; do not retry blindly — except `wait`, see §2) · `3` halugraph not
running (§9) · `127` no python found (§11).

---

## 9. When halugraph is not running (exit code 3)

1. Tell the user **in the terminal**: "halugraph is not running for this project. Start it with:
   `halugraph <project path>`" (the project path is your working directory).
2. Wait for it — do not `sleep` in a loop:
   `tools/cmd/halugraph-client ping --wait 540` with the Bash tool timeout 600000 ms. It returns as
   soon as halugraph answers (exit 0), or exits 3 after 9 minutes.
3. As soon as it answers, run the startup sequence (§1) again and continue the loop.
4. Still exit 3? Remind the user once more and run `ping --wait 540` one more time. After that, stop
   and tell the user: start halugraph, then tell me "Read AGENTS.md and strictly follow it."

---

## 10. Per-event checklist

- [ ] `status agent "<doing what>" --state busy`
- [ ] follow the event's `instructions` (compile → `process/compile.md`)
- [ ] report problems with `error` (location flags, `--compile <id>` during compiles)
- [ ] tell the user the outcome (`notify`, or a `dialog` for anything longer than a sentence)
- [ ] update `agents/memory.md` (and `plan.md` for compiles)
- [ ] `status agent "Ready" --state idle`
- [ ] `wait` again — never stop

---

## 11. Windows

Run every command here and in `process/` with Claude Code's **Bash tool** (Git Bash): unchanged, same
timeouts — not the PowerShell tool, where `cp a b dir/`, `diff`, `grep` and `node -e '…'` break. No Bash
tool → ask the user to install Git for Windows. cmd.exe / PowerShell users: `tools\cmd\halugraph-client.cmd`.
Exit code `127` = no python 3.8+: ask the user to install it (python.org) or to set `HALUGRAPH_PYTHON`.

---

## 12. Codex

If you are Codex rather than Claude Code:

- Register with `tools/cmd/halugraph-client hello --name Codex`.
- Wait with `tools/cmd/halugraph-client wait --timeout 280` (also `--timeout 280` on `ask` / `dialog`,
  and `ping --wait 280`). When a command comes back as "Process running with session ID N", keep polling
  **that** session until it exits — never start a second `wait` while one runs.
- Exit code `2` "cannot reach halugraph from inside the Codex sandbox": the user has not trusted this
  folder yet (`.codex/rules/halugraph.rules` lets the client out of the sandbox once they do). Ask them to
  restart Codex here and trust the folder; do not `ping --wait`.

---

## 13. MCP tools

If your tool list has halugraph's MCP tools (Claude Code: `mcp__halugraph__…`; Codex: `mcp__halugraph`),
use them instead of the client — same events and rules, no shell timeouts:

- `hello`, then THE LOOP with `wait_for_event`: it blocks by itself and returns `{"type": "timeout"}`
  before your tool limit — call it again at once. Never two `wait_for_event` calls at the same time.
- Each client command but `ping` has a tool; its options are the arguments (`status agent "Ready" --state idle`
  → `set_status {"key": "agent", "text": "Ready", "state": "idle"}`). Use it wherever this manual,
  `process/` or an event's `instructions` name a client command; shell pipelines keep the client.
  All tools: `tools/doc/halugraph-mcp.md`.
- Claude Code: a call "moved to the background" → end your turn; its result comes as a task
  notification — handle it like a `wait_for_event` result (a `message` or `answer` in it is the
  artist writing).
- "halugraph is not running for this project" → §9; the tools work again once it runs.
