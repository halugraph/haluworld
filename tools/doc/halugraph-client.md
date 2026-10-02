# halugraph-client — reference

`tools/cmd/halugraph-client` is how you, the AI agent, talk to the halugraph server of this project.
The user patches graphs in the halugraph web UI; the server turns their actions (Compile, chat messages,
answers to your questions) into **events** that you receive with `wait`. You answer with commands that
show up in the UI: statuses, notifications, dialogs, problems, compile progress.

Everything the user sees from you goes through this client. Never talk to the HTTP API with `curl`.

`AGENTS.md` §8 has the compact command table for everyday work. This file is the full reference: open
it when you need a detail (a flag, an output shape, an exit code, a troubleshooting row), not every
session.

* Python ≥ 3.8, standard library only, a single executable file that finds a working python by itself
  (see [Python, shells and Windows](#python-shells-and-windows)).
* Run it from the project root: `tools/cmd/halugraph-client <command> [options]` — in every POSIX shell,
  including Git Bash on Windows.
* Every command prints **pretty JSON on stdout**. Failures print JSON `{"error", "hint"}` on **stderr**
  and exit non-zero (see [Exit codes](#exit-codes)). Read the `hint`: it tells you what to do.
* `tools/cmd/halugraph-client --help` and `tools/cmd/halugraph-client <command> --help` print usage with
  examples.

## Contents

1. [Quick start](#quick-start)
2. [Connection and project discovery](#connection-and-project-discovery)
3. [Python, shells and Windows](#python-shells-and-windows)
4. [Exit codes](#exit-codes)
5. [Commands](#commands)
6. [Events returned by `wait`](#events-returned-by-wait)
7. [The recommended loop](#the-recommended-loop)
8. [Troubleshooting](#troubleshooting)

## Quick start

```bash
tools/cmd/halugraph-client hello --name "Claude Code"   # once, when you start
tools/cmd/halugraph-client wait                         # blocks up to 540 s → prints the next event
# … do what the event's "instructions" say, then wait again …
```

`wait` blocks for up to 9 minutes by default. **Give your shell tool a 10-minute timeout** for `wait`,
`ask`, `dialog` and `ping --wait` (Claude Code: Bash `timeout: 600000`). If your tool cannot wait that long, pass a
shorter `--timeout` (for example `wait --timeout 100` under a 2-minute tool limit). Nothing is lost when
a `wait` is cut short or times out: undelivered events stay queued for the next `wait`.

**Waiting, per agent:**

| agent | how to wait |
|---|---|
| Claude Code | Bash tool `timeout: 600000` for `wait`, `ask`, `dialog`, `dialog-wait` and `ping --wait 540`; the defaults (540 s) fit. |
| Codex | `wait --timeout 280` (likewise `ask … --timeout 280`, `ping --wait 280`). Codex hands a command back after ~10 s as *Process running with session ID N* and then polls that session (up to 300 s per poll): keep polling **that** session until it exits — never start a second `wait` meanwhile. Codex needs the project folder trusted once (see *Codex sandbox* in [Troubleshooting](#troubleshooting)). |
| other tools | a `--timeout` a little below the tool's own command limit, e.g. `wait --timeout 100` under 2 minutes. |

## Connection and project discovery

**Project root.** The first match wins:

1. `--root DIR`. It must be the project root itself (the folder containing `.hlg`). It may come before or
   after the command.
2. The `HALUGRAPH_ROOT` environment variable (same rule).
3. The script's own location: `tools/cmd/halugraph-client` → `../..`, if that folder contains `.hlg`.
   This is the normal case: the client always finds its own project, whatever your current folder.
4. The current folder or the nearest parent folder that contains `.hlg`.

If none of these finds a project, the client exits 1 with a hint.

**Transport.** The server listens on a unix socket and on TCP (for the browser); on Windows the client
always uses TCP (step 2):

1. The unix socket named in `util/instance.json` (`"socket"`), then `util/halugraph.sock`. The socket
   moves to the temp folder when the project path is very long; `instance.json` then has the path.
2. If no socket answers, TCP at the `url` from `util/instance.json` (for example
   `http://127.0.0.1:4747/`). A stale `instance.json` whose process is gone is not used.

`util/instance.json` is only trusted when its `root` is this project. A folder copied while halugraph
was running carries the original's file; the client refuses it rather than talk to the other project's
server. TCP only ever goes to this machine (loopback or a local interface address), never to a remote
host named in `instance.json`.

If neither works, the client exits **3** with the hint
`halugraph is not running for <root>. Ask the user to start it: halugraph <root>`.

**Requests.** Every request carries the header `x-halugraph-client: agent`. The server uses it to show
you as *connected* in the UI. POST/PUT/DELETE requests send `Content-Type: application/json` and a JSON
body.

**Timeouts.** Ordinary requests time out after 30 s. `wait`, `ask`, `dialog` and `dialog-wait` use the
requested wait time plus 30 s, so the server always answers first. Waits are capped at 3600 s (the
server's limit); a larger `--timeout` is sent as 3600. `ping --wait S` retries every 0.2–1 s until
halugraph answers or `S` seconds pass (also capped at 3600).

**Limits and text.** Request bodies are limited to 10 MB (checked before anything is sent). Arguments
that are not valid UTF-8 (bytes from a non-UTF-8 terminal) are sent with U+FFFD `�` in their place.
Output is always UTF-8 (whatever the console code page), unless `PYTHONIOENCODING` says otherwise.

## Python, shells and Windows

`tools/cmd/halugraph-client` is its own launcher: its first lines are a small `sh` script that picks a
python and runs the same file with it. The first that works wins: `$HALUGRAPH_PYTHON` (a path to a
python executable, if set), `python3`, `python`, `py -3`. Each is tried with a tiny probe first, so a
`python3` that is only the **Microsoft Store** stub (Windows puts one on the PATH) or a python older
than 3.8 is skipped. No working python → exit **127** with `{"error", "hint"}` on stderr; ask the user
to install Python 3.8+ (python.org; on Windows tick *Add python.exe to PATH*) or to set
`HALUGRAPH_PYTHON`. `python3 tools/cmd/halugraph-client …` still works where `python3` is a real python.

**Windows.**

* **Git Bash** — Claude Code's **Bash tool** on Windows: run exactly the commands of this reference, with
  `/` in paths. The launcher turns `--root`, `--file` and `$HALUGRAPH_ROOT` given as `/c/Users/…` into
  Windows paths itself and keeps Git Bash from rewriting other arguments — text such as
  `notify "Open /preview/latest/"` arrives unchanged. Claude Code may also offer a **PowerShell tool**;
  run the commands of `AGENTS.md` and `process/` with the Bash tool (they are POSIX shell commands).
* **cmd.exe / PowerShell**: `tools\cmd\halugraph-client.cmd` with the same arguments, output and exit
  codes (it tries `py -3`, `python`, `python3`). PowerShell also runs `tools/cmd/halugraph-client …` as
  written (it finds the `.cmd`); cmd.exe needs the backslashes. Windows PowerShell 5.1 decodes captured
  output with the console code page: run `[Console]::OutputEncoding = [Text.Encoding]::UTF8` first when you
  pipe the JSON on (`| ConvertFrom-Json`), or non-ASCII text arrives garbled. After Ctrl+C, cmd.exe may ask
  *Terminate batch job (Y/N)?*: the client has already stopped (exit 130), answer either way.
* The client talks **TCP** to the `url` in `util/instance.json` (halugraph listens on a named pipe
  instead of a unix socket there); the same trust rules apply: only this project's file, only this
  machine.
* Output is UTF-8 even on a `cp1252` / `cp437` console. Ctrl+C — or **Ctrl+Break** — ends a blocking
  `wait` at once with exit 130.

## Exit codes

| code | meaning | what to do |
|---|---|---|
| `0` | success; the JSON result is on stdout | continue |
| `1` | usage error: bad command or flag, empty id/name, unreadable `--file`, request over 10 MB, no project found | fix the command (see `hint`, `--help`) |
| `2` | request failed: the server answered 4xx/5xx (its `error`/`hint` and `status` are printed), timed out, or sent invalid JSON; the Codex sandbox blocked the connection (`cannot reach halugraph from inside the Codex sandbox`); also an internal client error (`halugraph-client internal error: …`) | read `error`/`hint`; fix and retry, or tell the user |
| `3` | halugraph is not running for this project (or the connection dropped) | ask the user to start it: `halugraph <root>`; do not start it yourself |
| `127` | no working python 3.8+ found by the launcher (JSON on stderr, see [Python, shells and Windows](#python-shells-and-windows)) | ask the user to install Python 3.8+ or to set `HALUGRAPH_PYTHON` |
| `130` | interrupted (Ctrl+C / SIGINT; Ctrl+Break on Windows); nothing printed | just run the command again |

Error output (stderr) example, exit code 2:

```json
{
  "error": "graph not found: synth/voce",
  "hint": "Not found: check the name or id (list them with: graphs, nodes, compile list, events).",
  "status": 404
}
```

Exit code 3:

```json
{
  "error": "cannot reach halugraph: no live socket and util/instance.json is missing",
  "hint": "halugraph is not running for /home/ada/art/synth. Ask the user to start it: halugraph /home/ada/art/synth"
}
```

## Commands

Synopsis notation: `[x]` optional, `x…` repeatable, `A | B` alternatives. Free-text positionals
(QUESTION, MESSAGE, TEXT) may be several words; they are joined with spaces. Quoting is still
recommended. Every command also accepts `--root DIR`.

The client prints the server's JSON response unchanged. `ask` and `ping` are the exceptions: they
summarise it. Some responses are plain acknowledgements whose exact shape depends on the server version:
`log`, `status --clear`, `dialog-cancel`, `errors clear`, `compile start/progress/done`. Only check their
exit code. An empty response body prints `{"ok": true}`.

| command | endpoint | purpose |
|---|---|---|
| [`hello`](#hello--announce-yourself) | POST /api/agent/hello | announce yourself, get project + protocol |
| [`wait`](#wait--block-until-the-next-event) | POST /api/agent/wait | next event (long-poll) |
| [`events`](#events--peek-at-the-queue) | GET /api/agent/events | peek at queued events |
| [`ask`](#ask--ask-the-user-a-question) | POST /api/dialogs | question dialog; prints `answered` (with the answer), `pending` (answer comes later as an `answer` event) or `cancelled` |
| [`dialog`](#dialog--show-a-markdown-dialog) | POST /api/dialogs | markdown dialog with custom buttons |
| [`dialog-wait`](#dialog-wait--wait-for-a-dialogs-answer) | GET /api/dialogs/:id?wait= | wait for an open dialog |
| [`dialog-cancel`](#dialog-cancel--close-a-dialog) | DELETE /api/dialogs/:id | close a dialog |
| [`notify`](#notify--toast-notification) | POST /api/agent/notify | toast notification |
| [`status`](#status--status-line-with-progress) | POST/DELETE /api/agent/status | status line + progress |
| [`log`](#log--agent-log-line) | POST /api/agent/log | agent log line |
| [`error`](#error--report-a-problem) | POST /api/diagnostics | report a problem |
| [`errors list` / `errors clear`](#errors-list--errors-clear--list-or-clear-reported-problems) | GET/DELETE /api/diagnostics | list/clear your problems |
| [`compile start/progress/done/list`](#compile-start--compile-progress--compile-done--compile-list--compile-lifecycle) | /api/compile/* | compile lifecycle |
| [`info` / `project`](#info--project--project-info) | GET /api/project | project info |
| [`ping`](#ping--is-halugraph-reachable) | GET /api/project | reachability check; `--wait S` blocks until halugraph answers (exit 3 when `S` seconds pass) |
| [`graphs` / `nodes`](#graphs--nodes--list-graphs-and-node-types) | GET /api/graphs, /api/nodes | lists |
| [`graph`](#graph--read-a-graph) | GET /api/graph, /api/resolved | read a graph (resolved for compiling) |
| [`node`](#node--read-a-node-type) | GET /api/node | read a node type |
| [`validate`](#validate--check-graphs-and-node-types) | GET /api/validate | validator diagnostics |

### `hello` — announce yourself

```
tools/cmd/halugraph-client hello [--name N]
```

`POST /api/agent/hello {"name"?}`. Marks you as connected in the UI (agent chip, Agent panel). Prints the
project info, a short protocol reminder (`instructions`) and how many events are already waiting. Call it
once when you start, then `wait`. `url` is the editor; `previewBaseUrl` is where builds are served — their
own origin (the same host on another port), so a compile's `previewUrl` path resolves against it
(`/preview/<id>/` → `http://127.0.0.1:4748/preview/<id>/`).

| flag | meaning |
|---|---|
| `--name N` | your name as shown in the UI: `"Claude Code"`, or `Codex` — the name also picks how the `instructions` tell you to wait (Codex: `wait --timeout 280`) |

```bash
tools/cmd/halugraph-client hello --name "Claude Code"
```

```json
{
  "project": {
    "root": "/home/ada/art/synth",
    "hlg": { "halugraph": "0.1.0", "name": "synth", "description": "A reactive synth", "main": "main" },
    "version": "0.1.0",
    "url": "http://127.0.0.1:4747/",
    "previewBaseUrl": "http://127.0.0.1:4748/preview/",
    "socket": "/home/ada/art/synth/util/halugraph.sock",
    "pid": 41235
  },
  "instructions": "You are connected to halugraph. Call `tools/cmd/halugraph-client wait` and follow each event's instructions …",
  "pendingEvents": 1
}
```

### `wait` — block until the next event

```
tools/cmd/halugraph-client wait [--timeout S]
```

`POST /api/agent/wait {"timeout": S}`. Blocks until an event is queued, then removes it from the queue
and prints it exactly as the server sent it. After `S` seconds with nothing to do it prints a `timeout`
event. The event types are described in [Events returned by `wait`](#events-returned-by-wait).

| flag | meaning |
|---|---|
| `--timeout S` | seconds to block; default `540`, at most `3600` (larger values are capped). The socket timeout is S + 30 s |

```bash
tools/cmd/halugraph-client wait
tools/cmd/halugraph-client wait --timeout 100    # when your shell tool allows only ~2 minutes
```

```json
{
  "id": "ev-7",
  "type": "timeout",
  "createdAt": "2026-09-28T18:09:00.000Z",
  "instructions": "Nothing happened. Call `tools/cmd/halugraph-client wait` again immediately."
}
```

### `events` — peek at the queue

```
tools/cmd/halugraph-client events
```

`GET /api/agent/events`. Lists the queued events **without** consuming them. Handy for debugging; for
normal work use `wait`.

```json
{
  "events": [
    {
      "id": "ev-8",
      "type": "message",
      "createdAt": "2026-09-28T18:10:02.000Z",
      "instructions": "The user sent you a message …",
      "text": "Make the background darker"
    }
  ]
}
```

### `ask` — ask the user a question

```
tools/cmd/halugraph-client ask QUESTION [--title T] [--choice C]… [--input | --no-input] [--timeout S]
```

`POST /api/dialogs {"title", "markdown": QUESTION, "actions", "input", "wait": S}`. Opens a dialog in the
UI and waits up to `S` seconds (default 540) for the answer. The UI never blocks: the user may put the
question aside and answer later.

* no `--choice` → a text field and a **Submit** button (`--no-input` → only an **OK** button)
* with `--choice` → one button per choice, and a text field only with `--input`

| flag | meaning |
|---|---|
| `--title T` | dialog title (default `"Question from the agent"`) |
| `--choice C` | an answer button; repeat for several (`--choice Yes --choice No`) |
| `--input` / `--no-input` | force the text field on or off |
| `--timeout S` | seconds to wait for the answer (default `540`) |

```bash
tools/cmd/halugraph-client ask "The slider has no range. What should it control?"
tools/cmd/halugraph-client ask "Which look?" --choice Minimal --choice Psychedelic --title "Visual style"
```

The output is always one of three shapes:

```json
{
  "status": "answered",
  "action": "Submit",
  "text": "The filter cutoff, 200–8000 Hz",
  "dialogId": "d-3f2a"
}
```

(`text` is `null` when the dialog had no text field.)

```json
{
  "status": "pending",
  "dialogId": "d-3f2a",
  "hint": "the answer will arrive via wait as an 'answer' event"
}
```

```json
{
  "status": "cancelled",
  "dialogId": "d-3f2a"
}
```

On `pending` the dialog stays open. Continue with other work or `wait`; the answer arrives as an
[`answer` event](#answer). You can also block again with `dialog-wait d-3f2a` or withdraw the question
with `dialog-cancel d-3f2a`.

### `dialog` — show a markdown dialog

```
tools/cmd/halugraph-client dialog --title T (--markdown M | --file F) [--action A]… [--input] [--no-wait] [--timeout S]
```

`POST /api/dialogs {"title", "markdown", "actions", "input", "wait"}`. For longer content such as a plan,
a summary of assumptions or a list of problems. Markdown with GitHub extensions (tables, task lists) is
rendered. The last action is the primary button.

| flag | meaning |
|---|---|
| `--title T` | dialog title (required) |
| `--markdown M` | the markdown body, inline |
| `--file F` | read the body from a UTF-8 file (`-` = stdin), e.g. your `plan.md` |
| `--action A` | a button; repeat for several (default one `OK` button) |
| `--input` | also show a text field; its value comes back in `answer.text` |
| `--no-wait` | return immediately with the open dialog (`wait` = 0) |
| `--timeout S` | seconds to wait for the answer (default `540`) |

```bash
tools/cmd/halugraph-client dialog --title "Compile plan" --file agents/compiles/20260928-180000/plan.md \
  --action "Stop" --action "Build it"
```

Prints the server's dialog as is. Check `dialog.state`: `answered` (see `dialog.answer`), `open` (not yet
answered; it arrives via `wait` as an `answer` event) or `cancelled`.

```json
{
  "dialog": {
    "id": "d-4c19",
    "title": "Compile plan",
    "markdown": "# Plan\n\n| node | module |\n|---|---|\n| osc1 | src/nodes/main/osc1.ts |",
    "actions": ["Stop", "Build it"],
    "input": null,
    "source": "agent",
    "createdAt": "2026-09-28T18:02:11.000Z",
    "state": "answered",
    "answer": { "action": "Build it", "answeredAt": "2026-09-28T18:02:40.000Z" }
  }
}
```

### `dialog-wait` — wait for a dialog's answer

```
tools/cmd/halugraph-client dialog-wait ID [--timeout S]
```

`GET /api/dialogs/<ID>?wait=S`. Blocks until the dialog is answered or cancelled, or `S` seconds pass
(default 540). Prints `{"dialog": {...}}` like `dialog`. If `state` is still `open`, the timeout passed.

| flag | meaning |
|---|---|
| `--timeout S` | seconds to wait (default `540`) |

```bash
tools/cmd/halugraph-client dialog-wait d-3f2a --timeout 60
```

```json
{
  "dialog": {
    "id": "d-3f2a",
    "title": "Question from the agent",
    "markdown": "The slider has no range. What should it control?",
    "actions": ["Submit"],
    "input": {},
    "source": "agent",
    "createdAt": "2026-09-28T18:01:00.000Z",
    "state": "open"
  }
}
```

### `dialog-cancel` — close a dialog

```
tools/cmd/halugraph-client dialog-cancel ID
```

`DELETE /api/dialogs/<ID>`. Withdraws a question you no longer need answered. The dialog disappears from
the UI and its state becomes `cancelled`.

```bash
tools/cmd/halugraph-client dialog-cancel d-3f2a
```

```json
{
  "dialog": {
    "id": "d-3f2a",
    "title": "Question from the agent",
    "markdown": "The slider has no range. What should it control?",
    "actions": ["Submit"],
    "input": {},
    "source": "agent",
    "createdAt": "2026-09-28T18:01:00.000Z",
    "state": "cancelled"
  }
}
```

### `notify` — toast notification

```
tools/cmd/halugraph-client notify MESSAGE [--level info|success|warning|error] [--title T]
```

`POST /api/agent/notify {"message", "level"?, "title"?}`. A toast in the UI's corner, also kept in the
bell menu. Use it for short news the user does not have to answer ("Build ready", "I renamed node x").
Errors stay on screen until dismissed.

| flag | meaning |
|---|---|
| `--level L` | `info` (default), `success`, `warning`, `error` |
| `--title T` | optional title |

```bash
tools/cmd/halugraph-client notify "Build ready — try it in the Preview panel" --level success
```

```json
{
  "notification": {
    "id": "n-12",
    "level": "success",
    "message": "Build ready — try it in the Preview panel",
    "source": "agent",
    "createdAt": "2026-09-28T18:05:00.000Z"
  }
}
```

### `status` — status line with progress

```
tools/cmd/halugraph-client status KEY TEXT [--state idle|busy|done|error] [--progress P]
tools/cmd/halugraph-client status KEY --clear
```

`POST /api/agent/status {"key", "text", "state"?, "progress"?}` (create or replace the status with that
key) or `DELETE /api/agent/status/<KEY>` (remove it). Busy statuses show a thin progress bar in the UI
status bar and never block the user. The server manages the `compile` key itself during compiles: use
`compile progress` for compile progress and your own keys (`build`, `review`, `edit`…) for other work.
Clear statuses you set when you are done.

| flag | meaning |
|---|---|
| `--state S` | `idle`, `busy` (default), `done`, `error` |
| `--progress P` | fraction `0..1` (e.g. `0.5`); omit for an indeterminate bar |
| `--clear` | remove the status (no TEXT) |

```bash
tools/cmd/halugraph-client status build "Installing the toolchain (first time only)…" --state busy
tools/cmd/halugraph-client status build --clear
```

```json
{
  "status": {
    "key": "build",
    "text": "Installing the toolchain (first time only)…",
    "state": "busy",
    "updatedAt": "2026-09-28T18:03:00.000Z"
  }
}
```

### `log` — agent log line

```
tools/cmd/halugraph-client log TEXT [--level debug|info|warning|error]
```

`POST /api/agent/log {"text", "level"?}`. Appends a line to the timeline in the Agent panel. Log what you
are doing at a useful granularity: one line per step, not per file.

| flag | meaning |
|---|---|
| `--level L` | `debug`, `info` (default), `warning`, `error` |

```bash
tools/cmd/halugraph-client log "Reviewed graph main: 7 nodes, 1 warning"
```

```json
{
  "ok": true
}
```

(The exact acknowledgement object depends on the server version; an empty 2xx body prints
`{"ok": true}`.)

### `error` — report a problem

```
tools/cmd/halugraph-client error MESSAGE [--severity error|warning|info] [--code C] [--graph G] [--node N]
    [--port P] [--side input|output] [--node-type T] [--file F] [--line L] [--compile ID]
```

`POST /api/diagnostics {"diagnostics": [ { … } ]}`. Adds one entry to the Problems window. Point at the
exact place so that a click takes the user there: a node's port (`--graph --node --port`), a node type
(`--node-type`) or a file (`--file --line`). Write the message for an artist: what is wrong and how to
fix it. Tag problems found during a compile with `--compile ID`.

| flag | JSON field | meaning |
|---|---|---|
| `--severity S` | `severity` | `error` (default on the server), `warning`, `info` |
| `--code C` | `code` | kebab-case machine code, e.g. `missing-input`, `contradiction` |
| `--graph G` | `graph` | graph name, e.g. `synth/voice` |
| `--node N` | `node` | node id in that graph |
| `--port P` | `port.name` | port name; `#N` means the N-th port (0-based) → `port.index` |
| `--side S` | `port.side` | `input` (default) or `output`; only used with `--port` |
| `--node-type T` | `nodeType` | node type name, e.g. `audio/oscillator` |
| `--file F` | `file` | project-relative file |
| `--line L` | `line` | 1-based line in that file |
| `--compile ID` | `compileId` | the compile this problem belongs to |

```bash
tools/cmd/halugraph-client error "The filter cutoff is wired to a colour; connect a number (Hz) instead" \
  --severity warning --code type-mismatch --graph main --node filter1 --port cutoff --compile 20260928-180000
```

Request body sent:

```json
{
  "diagnostics": [
    {
      "message": "The filter cutoff is wired to a colour; connect a number (Hz) instead",
      "severity": "warning",
      "code": "type-mismatch",
      "graph": "main",
      "node": "filter1",
      "port": { "side": "input", "name": "cutoff" },
      "compileId": "20260928-180000"
    }
  ]
}
```

Output (the stored diagnostics):

```json
{
  "diagnostics": [
    {
      "id": "agent-5",
      "severity": "warning",
      "code": "type-mismatch",
      "message": "The filter cutoff is wired to a colour; connect a number (Hz) instead",
      "source": "agent",
      "graph": "main",
      "node": "filter1",
      "port": { "side": "input", "index": 1, "name": "cutoff" },
      "compileId": "20260928-180000",
      "createdAt": "2026-09-28T18:04:00.000Z"
    }
  ]
}
```

### `errors list` / `errors clear` — list or clear reported problems

```
tools/cmd/halugraph-client errors list
tools/cmd/halugraph-client errors clear [--compile ID]
```

`GET /api/diagnostics` lists the agent- and server-reported problems. The UI computes validator problems
itself; get those with `validate`. `DELETE /api/diagnostics[?compileId=ID]` clears the agent problems, all
of them or only one compile's. Clear a compile's old problems before you report new ones for a re-run.

| flag | meaning |
|---|---|
| `--compile ID` | (clear) only this compile's problems. An empty ID is a usage error, never "clear everything" |

```bash
tools/cmd/halugraph-client errors clear --compile 20260928-180000
```

```json
{
  "diagnostics": []
}
```

### `compile start` / `compile progress` / `compile done` / `compile list` — compile lifecycle

```
tools/cmd/halugraph-client compile start ID
tools/cmd/halugraph-client compile progress ID TEXT [--progress P]
tools/cmd/halugraph-client compile done ID [--failed] [--summary S]
tools/cmd/halugraph-client compile list
```

The compile procedure lives in `process/compile.md`; these commands report its lifecycle:

* `compile start ID`: `POST /api/compile/start {"id"}`. Run it first when a `compile` event arrives. The
  record becomes `running`.
* `compile progress ID TEXT`: `POST /api/compile/progress {"id", "text", "progress"?}`. Shown in the
  status bar and the Compiles panel.
* `compile done ID`: `POST /api/compile/done {"id", "status": "succeeded"|"failed", "summary"?}`. For
  `succeeded`, `agents/compiles/build/<ID>/index.html` must exist, otherwise the server answers 400 with
  a hint. The server then copies the build to `agents/compiles/build/latest/` and the Preview reloads.
  Finishing a compile that the user cancelled succeeds, but it stays cancelled.
* `compile list`: `GET /api/compiles`, newest first.

| flag | meaning |
|---|---|
| `--progress P` | (progress) fraction `0..1` |
| `--failed` | (done) report failure instead of success |
| `--summary S` | (done) one line for the user: what was built, or why it failed |

```bash
tools/cmd/halugraph-client compile start 20260928-180000
tools/cmd/halugraph-client compile progress 20260928-180000 "Generating node modules (3/7)" --progress 0.4
tools/cmd/halugraph-client compile done 20260928-180000 --summary "Synth with 7 nodes; the knob controls cutoff"
```

```json
{
  "compile": {
    "id": "20260928-180000",
    "graph": "main",
    "state": "succeeded",
    "requestedAt": "2026-09-28T18:00:00.000Z",
    "startedAt": "2026-09-28T18:00:03.000Z",
    "finishedAt": "2026-09-28T18:04:30.000Z",
    "summary": "Synth with 7 nodes; the knob controls cutoff",
    "commit": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    "previewUrl": "/preview/20260928-180000/"
  }
}
```

`compile list`:

```json
{
  "compiles": [
    { "id": "20260928-180000", "graph": "main", "state": "succeeded", "requestedAt": "2026-09-28T18:00:00.000Z" }
  ]
}
```

### `info` / `project` — project info

```
tools/cmd/halugraph-client info
tools/cmd/halugraph-client project
```

`GET /api/project`. The two names do the same thing.

```json
{
  "root": "/home/ada/art/synth",
  "hlg": { "halugraph": "0.1.0", "name": "synth", "description": "A reactive synth", "main": "main" },
  "version": "0.1.0",
  "url": "http://127.0.0.1:4747/",
  "previewBaseUrl": "http://127.0.0.1:4748/preview/",
  "socket": "/home/ada/art/synth/util/halugraph.sock",
  "pid": 41235
}
```

### `ping` — is halugraph reachable?

```
tools/cmd/halugraph-client ping [--wait S]
```

`GET /api/project`, summarised. `via` says how the client connected (`unix` or `tcp`). Without
`--wait` it is one attempt: exit 0 when halugraph answers, exit 3 when it is not running.

| flag | meaning |
|---|---|
| `--wait S` | keep trying for up to `S` seconds (at most `3600`) until halugraph answers: retries every 0.2–1 s while it is not running (or not answering yet). Exit 0 as soon as it answers, with `waited` (seconds) in the output; exit **3** when the time is up (`halugraph did not answer within S s (…last reason…)`). An HTTP error is an answer: exit 2 at once. |

Use `ping --wait` instead of `sleep` loops when halugraph is not running: ask the user to start it,
then block until it is up (give the shell tool a 10-minute timeout for `--wait 540`).

```bash
tools/cmd/halugraph-client ping
tools/cmd/halugraph-client ping --wait 540    # after asking the user to start halugraph
```

```json
{
  "ok": true,
  "url": "http://127.0.0.1:4747/",
  "root": "/home/ada/art/synth",
  "via": "unix"
}
```

With `--wait`:

```json
{
  "ok": true,
  "url": "http://127.0.0.1:4747/",
  "root": "/home/ada/art/synth",
  "via": "unix",
  "waited": 12.4
}
```

Exit code 3 after `--wait 540`:

```json
{
  "error": "halugraph did not answer within 540 s (cannot reach halugraph: no live socket and util/instance.json is missing)",
  "hint": "halugraph is not running for /home/ada/art/synth. Ask the user to start it: halugraph /home/ada/art/synth"
}
```

### `graphs` / `nodes` — list graphs and node types

```
tools/cmd/halugraph-client graphs
tools/cmd/halugraph-client nodes
```

`GET /api/graphs` / `GET /api/nodes`, sorted by name.

```json
{
  "graphs": [
    { "name": "examples/synth", "file": "graphs/examples/synth.yml" },
    { "name": "main", "file": "graphs/main.yml" }
  ]
}
```

```json
{
  "nodes": [
    { "name": "audio/oscillator", "file": "nodes/audio/oscillator.yaml", "category": "Audio" },
    { "name": "output", "file": "nodes/output.yaml", "category": "Core" }
  ]
}
```

### `graph` — read a graph

```
tools/cmd/halugraph-client graph NAME [--resolved] [--compile ID]
```

* Without flags: `GET /api/graph?name=NAME` returns the raw YAML `text`, the parsed `graph` and its
  `diagnostics`. Read this before you edit a graph file.
* `--resolved`: `GET /api/resolved?name=NAME` returns the graph with every node's type definition inlined
  (`definition`), the wires as `edges`, the graph's `interface`, its `dependencies` and all `subgraphs`.
  **Compile from this.** A **custom port** — one the user added to this node only, which its node type
  does not declare (for a subgraph node: not in the called graph's interface) — carries `"custom": true`;
  declared ports have no `custom` key. Implement a custom port from its name, its `description` and the
  node's action.
  A node's **`attachments`** are files the artist attached: `file` (project-relative,
  `assets/<hash>-<name>`; in a compile's snapshot at `agents/compiles/<ID>/input/<file>`), `name`,
  `role`, `mime`, `description` and file facts when known — `size` (bytes), `width` / `height`
  (pixels of pictures and videos), `duration` (seconds of sounds and videos). A `reference` guides
  you (open pictures, sketches and PDFs with your Read tool); an `embed` ships in the app and is read
  with `ctx.attachment(name)` — `process/compile.md` Steps 2 and 7.
* `--compile ID` (implies `--resolved`): `GET /api/resolved?name=NAME&compile=ID` reads the compile's
  frozen snapshot (`agents/compiles/<ID>/input`) instead of the live files, which the user may already be
  editing again.

| flag | meaning |
|---|---|
| `--resolved` | resolved graph (definitions inlined, edges, subgraphs) |
| `--compile ID` | from that compile's snapshot (implies `--resolved`; an empty ID is a usage error) |

```bash
tools/cmd/halugraph-client graph main --resolved --compile 20260928-180000
```

```json
{
  "name": "main",
  "description": "Tiny synth with a frequency slider",
  "nodes": [
    {
      "id": "slider1",
      "type": "ui/slider",
      "action": "Frequency slider, 50–2000 Hz, logarithmic feel",
      "inputs": [
        { "name": "min", "connection": [] },
        { "name": "reset", "description": "a bang jumps back to 440 Hz", "connection": [], "custom": true }
      ],
      "outputs": [{ "name": "value", "connection": ["osc1.frequency"] }],
      "definition": {
        "function": "A horizontal slider …",
        "approach": "An <input type=range> …",
        "deliverables": "element, value …",
        "preconditions": "…"
      }
    },
    {
      "id": "app",
      "type": "output",
      "action": "A dark page laid out like the sketch",
      "inputs": [{ "name": "content", "connection": ["slider1.element"] }],
      "outputs": [],
      "attachments": [
        {
          "file": "assets/3f9a2c1be07d44aa-layout.sketch.png",
          "name": "layout sketch",
          "role": "reference",
          "mime": "image/png",
          "description": "The slider full width at the bottom, a big frequency readout above it",
          "size": 48213,
          "width": 1280,
          "height": 800
        }
      ],
      "definition": { "function": "The root of the compiled app …", "approach": "…", "deliverables": "…", "preconditions": "…" }
    }
  ],
  "edges": [
    { "id": "slider1.0->osc1.0", "source": { "node": "slider1", "index": 0 }, "target": { "node": "osc1", "index": 0 } }
  ],
  "interface": { "inputs": [], "outputs": [] },
  "dependencies": [],
  "subgraphs": {},
  "diagnostics": []
}
```

### `node` — read a node type

```
tools/cmd/halugraph-client node NAME
```

`GET /api/node?name=NAME` returns `text` (YAML), the parsed `nodeType` and `diagnostics`.

```bash
tools/cmd/halugraph-client node audio/oscillator
```

```json
{
  "name": "audio/oscillator",
  "file": "nodes/audio/oscillator.yaml",
  "text": "description: Sine/square/saw/triangle oscillator\n…",
  "nodeType": {
    "function": "Generates a periodic audio-rate signal.",
    "approach": "Web Audio API OscillatorNode …",
    "deliverables": "An audio source exposing `signal` …",
    "preconditions": "Audible only when connected to an audio/dac …",
    "description": "Sine/square/saw/triangle oscillator",
    "category": "Audio",
    "inputs": [{ "name": "frequency" }, { "name": "type" }, { "name": "detune" }],
    "outputs": [{ "name": "signal" }]
  },
  "diagnostics": []
}
```

### `validate` — check graphs and node types

```
tools/cmd/halugraph-client validate [--graph G]
```

`GET /api/validate[?graph=G]` returns the validator and YAML diagnostics computed from the files on disk.
Run it after you edit graph or node YAML.

| flag | meaning |
|---|---|
| `--graph G` | only this graph |

```json
{
  "diagnostics": [
    {
      "id": "validator:unknown-type:main:osc2:",
      "severity": "error",
      "code": "unknown-type",
      "message": "Node \"osc2\" has unknown type \"audio/oscilator\" (no nodes/audio/oscilator.yaml)",
      "source": "validator",
      "graph": "main",
      "node": "osc2"
    }
  ]
}
```

## Events returned by `wait`

`wait` returns the oldest queued event and removes it from the queue. Each event is delivered once. If
your `wait` is killed before delivery, the event stays queued. Every event has `id`, `type`, `createdAt`
and **`instructions`**: complete, imperative prose that names the exact commands and paths to use.
Follow the instructions; the notes below are the gist.

`save` is not an event. The server commits the user's saves to git by itself.

#### `compile`

The user pressed Compile. Run `compile start <compileId>`, follow `process/compile.md` using `paths`
(read the snapshot with `graph <graph> --resolved --compile <compileId>`), report problems with
`error … --compile <compileId>`, finish with `compile done`, then `wait` again. `previous` is the
successful compile this one builds on (the one of the same graph that finished last, else the one of
any graph that finished last), which you can reuse for an incremental build. When `seededFrom` is set,
halugraph already copied that compile's `app/` (sources, config, `node_modules`, caches — not `dist/` or
logs) into `paths.app`: update it in place instead of copying the template (process/compile.md
Steps 6–7). `diagnostics` are the validator's findings on the snapshot (plus a `seed-copy-failed`
warning when that copy failed — then `app/` does not exist and you start from the template).

```json
{
  "id": "ev-3",
  "type": "compile",
  "createdAt": "2026-09-28T18:00:00.000Z",
  "instructions": "Compile graph \"main\" (compile 20260928-180000). Run `tools/cmd/halugraph-client compile start 20260928-180000`, then follow process/compile.md …",
  "compileId": "20260928-180000",
  "graph": "main",
  "paths": {
    "root": "agents/compiles/20260928-180000",
    "input": "agents/compiles/20260928-180000/input",
    "app": "agents/compiles/20260928-180000/app",
    "build": "agents/compiles/build/20260928-180000",
    "latest": "agents/compiles/build/latest",
    "plan": "agents/compiles/20260928-180000/plan.md",
    "log": "agents/compiles/20260928-180000/build.log"
  },
  "diagnostics": [],
  "previous": "20260928-174512",
  "seededFrom": "20260928-174512",
  "previewUrl": "/preview/20260928-180000/"
}
```

#### `message`

The user wrote to you in the Agent panel. `context` says what they had selected: a graph, nodes or a
node type. Do what they ask. You may edit `graphs/*.yml` and `nodes/*.yaml` when asked; the UI reloads
them. Reply with `notify`, or with `dialog` for longer answers, then `wait` again.

```json
{
  "id": "ev-4",
  "type": "message",
  "createdAt": "2026-09-28T18:10:02.000Z",
  "instructions": "The user sent you a message. Do what it asks …, reply with notify or dialog, then wait again.",
  "text": "Add a reverb after the filter and wire it to the DAC",
  "context": { "graph": "main", "nodes": ["filter1"] }
}
```

#### `answer`

The user answered a dialog after your `ask`, `dialog` or `dialog-wait` had already returned `pending` or
`open`. Continue the task that needed the answer, then `wait` again.

```json
{
  "id": "ev-5",
  "type": "answer",
  "createdAt": "2026-09-28T18:12:40.000Z",
  "instructions": "The user answered your question \"Visual style\". Continue the task that needed it, then wait again.",
  "dialogId": "d-3f2a",
  "title": "Visual style",
  "action": "Psychedelic",
  "text": ""
}
```

#### `cancel`

The user cancelled a compile. Stop working on it immediately; the server has already marked it
cancelled. Then `wait` again.

```json
{
  "id": "ev-6",
  "type": "cancel",
  "createdAt": "2026-09-28T18:03:10.000Z",
  "instructions": "The user cancelled compile 20260928-180000. Stop working on it now, then wait again.",
  "compileId": "20260928-180000"
}
```

#### `timeout`

Nothing happened within the wait time. Call `wait` again immediately.

```json
{
  "id": "ev-7",
  "type": "timeout",
  "createdAt": "2026-09-28T18:09:00.000Z",
  "instructions": "Nothing happened. Call `tools/cmd/halugraph-client wait` again immediately."
}
```

#### `shutdown`

halugraph is stopping. Stop the loop and tell the user in your terminal that halugraph stopped. Further
commands would exit 3.

```json
{
  "id": "ev-8",
  "type": "shutdown",
  "createdAt": "2026-09-28T19:00:00.000Z",
  "instructions": "halugraph is shutting down. Stop the loop and tell the user that halugraph stopped."
}
```

## The recommended loop

```text
hello --name "Claude Code"                       # once; read "instructions" and "pendingEvents"
loop:
    event = wait                                  # shell tool timeout 10 min (or wait --timeout 100)
    exit code 3?  → tell the user "halugraph is not running — please start it: halugraph <root>",
                    then ping --wait 540 (shell tool timeout 10 min) and start over with hello
    switch event.type:
        compile  → compile start ID → process/compile.md → compile done ID [--failed] --summary …
        message  → do it → notify / dialog with the result
        answer   → continue the task that asked
        cancel   → stop that compile's work now
        timeout  → (nothing)
        shutdown → tell the user halugraph stopped; stop the loop
    (always follow event.instructions; they win over this sketch)
```

Good habits:

* **Keep the user informed without blocking them.** Use `status` / `compile progress` for long steps,
  `notify` for results, and `ask` / `dialog` only when you really need a decision.
* **Ask instead of guessing** when a graph is contradictory or an action is ambiguous. Report the
  specific spots with `error --graph --node --port` so the user can click to them.
* **One event at a time.** Finish, or deliberately park, the current event before you call `wait`
  again, and always go back to `wait`: the user cannot reach you otherwise.
* Clear your statuses (`status KEY --clear`) and withdraw obsolete questions (`dialog-cancel`).

## Troubleshooting

| symptom | cause and fix |
|---|---|
| exit 3, `halugraph is not running for …` | The server is not started for this project, or it stopped. Ask the user to run the command in the hint (`halugraph <root>`), then `ping --wait 540` (shell tool timeout 10 min) — it returns as soon as halugraph answers. Do not `sleep` in a loop. |
| exit 3, `halugraph did not answer within … s` | `ping --wait` gave up: halugraph was not started in time. Tell the user again (in the terminal) and wait once more, or stop and ask them to tell you when it runs. |
| exit 3 while `util/halugraph.sock` exists | A stale socket from a crashed server. The client already tried TCP too. Ask the user to restart halugraph, which cleans up. |
| exit 1, `no halugraph project found` | You are outside the project and the client is not the project's own copy. `cd` to the project root, or pass `--root <project>`. |
| exit 1, `--root … is not a halugraph project` | `--root` / `HALUGRAPH_ROOT` must be the folder that contains `.hlg`, not a subfolder. |
| exit 1, `the request is … MB; halugraph accepts at most 10 MB` | Your `dialog --file` (or other text) is too big. Show a summary and point to the file instead. |
| exit 3, `util/instance.json belongs to another project` / `has no "root"` / `is not an address of this machine` | The file was not written by halugraph for this folder (a copied project, or a file committed by someone else). Ask the user to start halugraph for this folder (`halugraph <root>`); that rewrites it. |
| exit 2, `cannot reach halugraph from inside the Codex sandbox (…)` | **Codex sandbox.** Codex runs commands in a sandbox without network, which also blocks halugraph on this computer (the client sees `CODEX_SANDBOX_NETWORK_DISABLED=1`). The project's `.codex/rules/halugraph.rules` lets the client out, but Codex loads it only for a trusted folder. Ask the user to quit Codex, start it again in the project folder and answer its "trust this folder" question with yes. Do not `ping --wait`: it cannot succeed until then. |
| exit 2, `halugraph-client internal error: …` | A bug in the client, not in your command. Tell the user and include the error. |
| `wait` / `ask` killed by your tool after ~2 min | Your shell tool's timeout is shorter than the wait. Raise it to 10 min, or pass `--timeout 100`. No event is lost. |
| exit 2, `request timed out` | The server did not answer within the wait time + 30 s. Retry; if it persists, ask the user whether halugraph hangs. |
| exit 2, HTTP 400 on `compile done` | `agents/compiles/build/<ID>/index.html` is missing. Build with `--base ./` into that folder first, or report `--failed`. |
| exit 2, HTTP 404 | Wrong graph/node/compile/dialog name or id. List them with `graphs`, `nodes`, `compile list`. |
| exit 2, HTTP 409 on a dialog | The dialog is no longer open: it was already answered or cancelled. |
| output looks escaped (`é`) | stdout is not UTF-8 (e.g. `PYTHONIOENCODING=ascii`). It is still valid JSON; any JSON parser decodes it. |
| exit 127, `no python 3.8 or newer found` | The launcher found no working python (a `python3` that is only the Microsoft Store stub does not count). Ask the user to install Python 3.8+ from python.org (Windows: tick *Add python.exe to PATH*) or to set `HALUGRAPH_PYTHON` to a python executable. |
| Windows: `toolscmdhalugraph-client: command not found` (exit 127, no JSON) | Backslashes are escapes in Git Bash. Write `tools/cmd/halugraph-client`; `tools\cmd\halugraph-client.cmd` is for cmd.exe / PowerShell. |
| names with `/` or spaces | Pass them as they are (`graph "my graphs/über synth"`); the client URL-encodes them. |
