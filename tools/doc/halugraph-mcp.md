# halugraph-mcp — reference

`tools/cmd/halugraph-mcp.mjs` is halugraph's **MCP server** for this project: the same protocol as
`tools/cmd/halugraph-client`, offered as MCP tools. Claude Code starts it from `.mcp.json`, Codex from
`.codex/config.toml`, both as `node tools/cmd/halugraph-mcp.mjs` in the folder the agent was started in
(halugraph's **Start agent** button starts the agent in the project folder). You never run it yourself.

`AGENTS.md` §13 is what you need every day. This file is the full reference: open it when a tool, an
argument, a limit or an error is unclear.

* Claude Code shows the tools as `mcp__halugraph__<tool>`; Codex shows them as the `mcp__halugraph` tools.
* Everything halugraph sends is in the result's **structured content** (an object, also as text): the event,
  its `instructions`, the project info. Claude Code shows you only the structured content.
* The client (`tools/cmd/halugraph-client`, `tools/doc/halugraph-client.md`) works next to it and stays
  the fallback: use it when the tools are missing, and for the shell pipelines in `process/`.

## Contents

1. [The loop over MCP](#the-loop-over-mcp)
2. [Tools](#tools)
3. [Results and errors](#results-and-errors)
4. [Resources and prompts](#resources-and-prompts)
5. [How long `wait_for_event` blocks](#how-long-wait_for_event-blocks)
6. [How it finds halugraph](#how-it-finds-halugraph)
7. [Checking the setup](#checking-the-setup)
8. [Troubleshooting](#troubleshooting)

## The loop over MCP

```
hello {"name": "Claude Code"}              # Codex: {"name": "Codex"}; once, when you start
repeat forever:
    event = wait_for_event {}              # blocks until an event, or returns {"type": "timeout"}
    handle the event by following its "instructions" field (AGENTS.md §3)
```

* Call `wait_for_event` again at once after a `timeout`. No shell timeout to set: halugraph ends every
  wait before your agent's own tool limit (see [How long `wait_for_event` blocks](#how-long-wait_for_event-blocks)).
* **Never run two `wait_for_event` calls at the same time**, and never start one in the background.
  halugraph serves one waiting call per connection: a new `wait_for_event` — or an `ask_user`,
  `show_dialog` or `dialog_wait` that waits — ends the call still waiting as if its time was up (a
  `timeout`, `pending`, the dialog still `open`).
* Events are never lost: an event that arrives while no call waits is queued for the next one, and a call
  that is cancelled (Esc in Claude Code), whose agent goes away or that a new call ends puts its event back
  in the queue. Codex never cancels a call it gives up on: your next call takes over from it, but an event
  that came in between went into the abandoned call — that is why its limit and halugraph's must match
  ([Troubleshooting](#troubleshooting)).
* Peek at the queue with `list_events` (it does not consume anything), like `events`.

## Tools

One tool per client command (`snake_case`; the arguments are the client's options without dashes) — except
`ping`: waiting for a stopped halugraph stays with the client (`ping --wait`, AGENTS.md §9).
Arguments marked `?` are optional. Where `AGENTS.md`, `process/` or an event's `instructions` name a
client command, call the matching tool — except in shell pipelines (`… | node -e …`), which keep the client.

| tool | arguments | client command | what it does |
|---|---|---|---|
| `hello` | `{name?}` | `hello` | registers you (shown as connected over MCP); project info + the loop instructions |
| `wait_for_event` | `{timeout_s?}` | `wait` | blocks for the next event (§3 of AGENTS.md lists them) |
| `list_events` | — | `events` | the queued events, without consuming them |
| `ask_user` | `{question, title?, choices?, input?, timeout_s?}` | `ask` | a blocking question → `answered` / `pending` / `cancelled` (AGENTS.md §4) |
| `show_dialog` | `{title, markdown, actions?, input?, wait?, timeout_s?}` | `dialog` | a markdown dialog (`wait: false` = `--no-wait`) |
| `dialog_wait` | `{id, timeout_s?}` | `dialog-wait` | waits for the answer to an open dialog |
| `dialog_cancel` | `{id}` | `dialog-cancel` | withdraws a dialog |
| `notify` | `{message, level?, title?}` | `notify` | a toast + the notification history |
| `set_status` | `{key, text, state?, progress?}` | `status KEY TEXT` | upserts a status line (`state`: `busy` / `idle` / `done` / `error`) |
| `clear_status` | `{key}` | `status KEY --clear` | removes a status line |
| `report_error` | `{message, severity?, code?, graph?, node?, port?, side?, node_type?, file?, line?, compile_id?}` | `error` | a problem in the Problems panel (`compile_id` = `--compile`, `node_type` = `--node-type`) |
| `list_errors` | — | `errors list` | the problems you reported |
| `clear_errors` | `{compile_id?}` | `errors clear` | clears them (one compile's only, with `compile_id`) |
| `log` | `{text, level?}` | `log` | a line in the Agent timeline |
| `compile_start` | `{id}` | `compile start` | a compile begins (`process/compile.md` Step 1) |
| `compile_progress` | `{id, text, progress?}` | `compile progress` | compile progress (Compiles panel + status bar) |
| `compile_done` | `{id, failed?, summary?}` | `compile done` | a compile ends (`failed: true` = `--failed`) |
| `list_compiles` | — | `compile list` | the compiles |
| `project_info` | — | `info` | project info, URLs |
| `list_graphs` | — | `graphs` | the graphs |
| `list_nodes` | — | `nodes` | the node types |
| `get_graph` | `{name, resolved?, compile_id?}` | `graph` | a graph (`resolved: true` = definitions inlined, subgraphs included) |
| `get_node` | `{name}` | `node` | a node type definition |
| `validate` | `{graph?}` | `validate` | validator diagnostics from disk |
| `get_attachment` | `{file, compile_id?}` | — | **MCP only**: an attachment (`assets/<hash>-<name>`); a PNG / JPEG / GIF / WebP picture up to 4 MB comes back as an image you see directly, anything else as its facts and path. With `compile_id`: the copy in that compile's snapshot (`agents/compiles/<id>/input/`) |

Examples (the client command → the tool call):

| client | MCP |
|---|---|
| `status agent "Compiling synth…" --state busy` | `set_status {"key": "agent", "text": "Compiling synth…", "state": "busy"}` |
| `compile progress <id> "Generating node modules" --progress 0.5` | `compile_progress {"id": "<id>", "text": "Generating node modules", "progress": 0.5}` |
| `error "Envelope has no gate" --severity error --graph synth --node env --compile <id>` | `report_error {"message": "Envelope has no gate", "severity": "error", "graph": "synth", "node": "env", "compile_id": "<id>"}` |
| `ask "Mono or poly?" --choice Mono --choice Poly` | `ask_user {"question": "Mono or poly?", "choices": ["Mono", "Poly"]}` |
| `graph synth --resolved --compile <id>` | `get_graph {"name": "synth", "resolved": true, "compile_id": "<id>"}` |

**Reference pictures.** A `reference` attachment (a sketch, a screenshot, a mock-up) is part of the node's
action: look at it with `get_attachment {"file": "assets/<hash>-<name>", "compile_id": "<id>"}` during a
compile (the snapshot's copy), or open `agents/compiles/<id>/input/<file>` with your Read tool — either
way, see it before you build (`process/compile.md` Step 2).

## Results and errors

* **Results**: structured content (always an object; lists are wrapped, e.g. `{"graphs": […]}`) plus the
  same as text. The shapes are those of the client's JSON output (`tools/doc/halugraph-client.md`).
* **A refused request** (unknown graph, a compile in the wrong state, …) is a tool result marked as an
  error (`isError`) whose structured content is `{"error", "hint", "status"}` (`status`: the HTTP status
  halugraph answered, e.g. 404 or 409) — read the hint, fix the call. Like the client's exit code `2`.
* **Bad arguments** (a missing or mistyped argument) → error `-32602`; its message says what is wrong.
* **`-32600` "Message too large: …"** — one call over the size limit (halugraph takes 11 MB; the MCP server
  passes on at most 16 MB): send less — keep long texts in a file and pass its path.
* **`-32000` "halugraph is not running for this project — ask the user to start it"** — halugraph is not
  reachable (stopped, restarting, or not started yet). Like the client's exit code `3`: AGENTS.md §9.
  Calls that were running when it stopped end with this error too; repeat them once halugraph runs.
* **"halugraph refused the MCP connection (HTTP …)"** — the halugraph that runs is older than this
  project's MCP server: use the client for this session.

## Resources and prompts

Clients that show MCP resources (`@` mentions in Claude Code) can read:

| resource | content |
|---|---|
| `halugraph://project` | project info (like `project_info`) |
| `halugraph://graph/{name}` | a graph as YAML |
| `halugraph://graph/{name}/resolved` | the resolved graph as JSON (like `get_graph` with `resolved`) |
| `halugraph://node/{name}` | a node type as YAML |
| `halugraph://compile/{id}` | a compile record |
| `halugraph://attachment/{file}` | an attachment (a picture, or its facts) |

Resources you subscribe to report changes of their files and compiles. Two prompts point at the
procedures: `compile {compile_id?}` (`process/compile.md`) and `review {graph?}` (`process/review.md`).
Dialogs and questions always appear in the halugraph UI, where the artist is — never as an MCP prompt
in your terminal.

## How long `wait_for_event` blocks

halugraph knows your agent from the MCP handshake and ends every wait before the agent's own limit
(without `timeout_s`, it waits as long as it may; a larger `timeout_s` is cut to that):

| agent | longest wait | why |
|---|---|---|
| Claude Code, auto-background off (`.claude/settings.json` sets `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` to `"0"`) | 540 s | |
| Claude Code otherwise | 100 s | Claude Code moves an MCP call that runs longer than 120 s to the background |
| Codex | `tool_timeout_sec − 60` (at most 540 s; `.codex/config.toml` sets 600), else 240 s | Codex cuts a tool call after `tool_timeout_sec` (300 s by default) and sends no cancel |
| any other client | 50 s | |

While a wait runs, halugraph sends progress every 15 s when the client asked for it (Claude Code does),
which keeps Claude Code's 30-minute idle timer alive. A wait that ends without an event returns
`{"type": "timeout"}` with instructions to call it again.

**Questions and dialogs that wait** — `ask_user`, `show_dialog` (unless `wait: false`) and `dialog_wait` —
block at most the same limit (a larger `timeout_s` is cut to it). Cut short, `ask_user` returns
`{"status": "pending", "dialogId": …}` and `show_dialog` / `dialog_wait` return the dialog still `open`:
note what the question was for (AGENTS.md §4); the artist's answer arrives later through `wait_for_event`
as an `answer` event.

**"moved to the background as task …" (Claude Code).** With auto-background on — `.claude/settings.json`
not loaded, or the variable overridden — Claude Code hands a long call to a background task and ends your
tool call. Do not call `wait_for_event` again (that would be two waits); end your turn. When the task
completes, Claude Code starts a turn with its result as a task notification marked "not user input":
handle the event in it exactly like a `wait_for_event` result — a `message` or an `answer` in it **is**
the artist writing to you through the halugraph UI — then continue the loop.

## How it finds halugraph

* **Project**: its own location — `tools/cmd/../..` must hold `.hlg` — never the working folder.
* **Server**: `util/instance.json` (a small regular file), trusted only when its `root` is this project
  (a folder copied while halugraph ran carries the original's file) and its halugraph process still runs.
  It connects to the agent socket first (Linux / macOS: a unix socket, Windows: a named pipe), then to the
  `url` — only when that is an address of this machine. Like the client (`tools/doc/halugraph-client.md`,
  *Connection and project discovery*).
* **halugraph not running yet**: it answers the MCP handshake itself (no tools yet, instructions saying
  halugraph is not running) and keeps looking for it in the background. Once halugraph runs, it tells
  the client to list the tools again: they appear by themselves (Claude Code: at your next turn).
* **halugraph restarts**: calls that were running end with `-32000`; the session (handshake, log level,
  subscriptions) is restored by itself and the tools are listed again. A halugraph that drops the
  connection right away is retried less and less often (up to every 5 s), never in a storm.
* It ends with its agent: end of its input, Ctrl+C / SIGINT, SIGTERM — and, checked every 2 s, when the
  agent CLI that started it is gone although its input never ended.
* It never piles anything up: it reads no more from halugraph while the agent CLI has not taken its output,
  and the reverse. An agent CLI that takes nothing for 2 minutes, or 64 MB of output nobody reads, ends it
  (exit code 1; its log says why; on Windows a write to the agent CLI simply waits until it reads). A
  halugraph that takes nothing for 2 minutes, or sends a line over 64 MB, is dropped like a crash and looked
  for again: calls that were running end with `-32000`.
* Its log goes to stderr (Claude Code shows it in its debug log, `claude --debug`; Codex in its log), one
  line per connection change; `HALUGRAPH_MCP_DEBUG=1` adds one line per message. Its stdout is MCP only.

Environment it reads: `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` and `HALUGRAPH_MCP_TOOL_TIMEOUT_SEC` (passed to
halugraph, which sizes the waits with them — see the table above), `HALUGRAPH_MCP_DEBUG` (Codex passes
only a few system variables plus the `env` table of `.codex/config.toml`: add it there), and
`HALUGRAPH_MCP_TEST_LIMITS` (halugraph's own tests: it can only lower the limits above).

## Checking the setup

The user (or you, in a shell) can check that the agent CLI found the server:

```bash
claude mcp list     # "halugraph: node tools/cmd/halugraph-mcp.mjs - ✔ Connected"
codex mcp list      # a "halugraph" row: node, tools/cmd/halugraph-mcp.mjs, enabled
```

`✔ Connected` also appears while halugraph is not running (the relay answers the handshake itself).
`⏸ Pending approval` means Claude Code has not loaded this project's settings yet: the folder is not
trusted, or Claude Code was started in another folder.

## Troubleshooting

| symptom | cause | what to do |
|---|---|---|
| no halugraph tools in your tool list (Claude Code) | the folder is not trusted yet (Claude Code asks once, "Yes, I trust this folder"), or Claude Code was started in a subfolder | use the client (AGENTS.md). Tell the user: start the agent with halugraph's **Start agent** button, or `claude` in the project folder, and trust the folder |
| no halugraph tools (Codex) | Codex reads `.codex/config.toml` only in a trusted folder, started from the project folder | as above, with `codex` |
| halugraph tools listed but empty; the server's instructions say halugraph is not running | halugraph was not running when the session started | ask the user to start halugraph (`halugraph <project folder>`); the tools appear by themselves. Meanwhile AGENTS.md §9 |
| `-32000` "halugraph is not running for this project — ask the user to start it" | halugraph stopped or restarted | AGENTS.md §9 (`tools/cmd/halugraph-client ping --wait 540`), then repeat the call |
| "halugraph refused the MCP connection (HTTP 404)" | the running halugraph is older than this project | use the client for this session; the user can update halugraph |
| a call came back "moved to the background as task …" | Claude Code's auto-background is on | end your turn; handle the task notification's result like a `wait_for_event` result (above). Tell the user once that `.claude/settings.json` is not in effect (an untrusted folder?) |
| Codex: "timed out awaiting tools/call after …s" | in `.codex/config.toml`, `tool_timeout_sec` is lower than `HALUGRAPH_MCP_TOOL_TIMEOUT_SEC` (halugraph sizes its waits by the second; both are 600 in a new project) — Codex gave up on a wait that halugraph still holds, without cancelling it | call `wait_for_event` again at once: it takes over from the abandoned call (halugraph ends that one as if its time was up; an event or a dialog answer that reached it at that moment goes back to the queue). An event that arrived between Codex giving up and your next call went into the abandoned call and is lost: tell the user to make both numbers equal and start Codex again, and to send their last message or compile again |
| every call asks for permission | Claude Code: the `mcp__halugraph` rule of `.claude/settings.json` is not loaded; Codex: `default_tools_approval_mode` likewise | the folder is not trusted: tell the user |
| the halugraph tools stopped working mid-session (the MCP server shows as failed or disconnected) | the MCP server ended: its agent CLI took nothing from it for 2 minutes, or it hit a limit (its log on stderr says which) | use the client for the rest of this session (AGENTS.md); tell the user that starting the agent again brings the tools back |
| the server fails to start ("node: not found", "spawn node ENOENT") | `node` is not on the agent's PATH | halugraph needs Node.js 22 or later: ask the user to install it, or to start the agent from a terminal where `node` works |
