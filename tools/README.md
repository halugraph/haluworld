# tools/

Command-line tools for the AI agent working on this halugraph project.

## Convention

Every tool is **one executable file** in `tools/cmd/`, and its reference is a markdown file with the same
name in `tools/doc/`:

| executable | documentation |
|---|---|
| `tools/cmd/<name>` | `tools/doc/<name>.md` |
| `tools/cmd/halugraph-client` | `tools/doc/halugraph-client.md` |
| `tools/cmd/halugraph-mcp.mjs` | `tools/doc/halugraph-mcp.md` (a file extension is not part of the name) |
| `tools/cmd/halugraph-picture.mjs` | `tools/doc/halugraph-picture.md` |

A tool may also have a `tools/cmd/<name>.cmd` next to it: the same tool for cmd.exe / PowerShell on
Windows (documented in the same `tools/doc/<name>.md`). In a POSIX shell — including **Git Bash**, Claude
Code's Bash tool on Windows — always run `tools/cmd/<name>` itself.

* **Read `tools/doc/<name>.md` before you use `tools/cmd/<name>`.** The doc is the contract: synopsis,
  flags, example invocations, example output, exit codes and troubleshooting. Every tool also has
  `--help`.
* Run tools from the project root, e.g. `tools/cmd/halugraph-client ping`.
* Tools print machine-readable output (JSON) on stdout. Errors go to stderr as JSON `{"error", "hint"}`
  with a non-zero exit code. Read the `hint`.

## Tools

| tool | what it does |
|---|---|
| [`halugraph-client`](doc/halugraph-client.md) | talks to the running halugraph server: receive events (`wait`), report compile progress, ask the user questions, show notifications/statuses, report problems, read graphs and node types. Python ≥ 3.8, standard library only; it finds a working python by itself (`python3`, `python` or `py -3`). |
| [`halugraph-picture`](doc/halugraph-picture.md) | the pictures of an app's link preview (the App node, `nodes/output.yaml`): `node tools/cmd/halugraph-picture.mjs app <id>` screenshots the build into `public/og-image.png`, `icon <id>` turns `public/icon.svg` into `apple-touch-icon.png`. Needs `playwright` on the PATH; without it, skip the picture — never install anything for it. Node, no dependencies. |
| [`halugraph-mcp`](doc/halugraph-mcp.md) | the same protocol as MCP tools: halugraph's MCP server for this project. Claude Code and Codex start it themselves (`.mcp.json`, `.codex/config.toml`) — you never run it; you call its tools (AGENTS.md §13). Node, no dependencies. |

## Adding a tool

If you (the agent) write a helper worth keeping for future compiles:

1. Put the executable in `tools/cmd/<name>`, with no file extension, a shebang and `chmod +x`. Prefer
   node with no dependencies (`#!/usr/bin/env node`): node is always installed next to halugraph, and that
   shebang also works in Git Bash on Windows — where `python3` may be the Microsoft Store stub.
2. Document it in `tools/doc/<name>.md` in the same shape as `halugraph-client.md`: purpose, synopsis,
   flags, examples with output, exit codes.
3. Mention it in `agents/memory.md` so that you remember it next time.

Do not modify `tools/cmd/halugraph-client`, `tools/cmd/halugraph-mcp.mjs` or `tools/cmd/halugraph-picture.mjs`. They ship with halugraph and
their documentation must stay accurate. If one misbehaves, tell the user.
