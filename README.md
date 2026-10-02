# haluworld

A vibrant demonstration of what halugraph can do

This folder is a **halugraph project**: you build a web app by patching nodes into graphs — like VVVV or
plugdata — and describing in plain words what each node should do. An AI agent (Claude Code or Codex) is
the compiler: it reads your graph and writes a real single-page web app, which you try right away in the
Preview.

## Start working

1. **Start halugraph** for this folder (it opens the editor in your browser, http://127.0.0.1:4747/ by
   default):

   ```bash
   halugraph .            # run inside this folder — or: halugraph /path/to/this/folder
   ```

2. **Start the agent.** In the editor, **Start agent** (Agent panel or status bar) opens a terminal tab
   running Claude Code or Codex for you. Or start it yourself in a second terminal, in this folder:

   ```bash
   claude          # or: codex
   ```

   and tell it: **Read AGENTS.md and strictly follow it.**
   The agent then waits for work; its status shows in the editor (bottom bar and Agent panel). You
   don't need to watch its terminal. The first time, Claude Code and Codex ask whether you trust this
   folder — answer yes: that turns on this folder's settings (`.claude/`, `.codex/`, `.mcp.json`), which let
   the agent reach halugraph directly.

3. **Patch → save → compile.** Edit a graph, press **Ctrl+S** to save (every save is a git commit you
   can go back to), press **F5** to compile. The result appears in the **Preview** panel and at
   `http://127.0.0.1:4748/preview/latest/` (previews run on their own port, next to the editor's).

New to halugraph? Help → Tutorial in the editor walks you through your first patch.
`graphs/examples/hello-button.yml` is the small reference patch the compile process imitates.

## Where things are

| path | what it is | who edits it |
|---|---|---|
| `graphs/` | your graphs (YAML) — `main.yml` is the one compiled by default | you (in the editor) |
| `nodes/` | node types: the Library. Each file describes what a node does, for the compiler | you — or the agent when you ask it |
| `assets/` | files attached to nodes (sketches, screenshots, sounds, pictures, data) — named by their content | you (in the editor: Inspector → Attachments) |
| `agents/` | the agent's workspace: memory, notes, every compile and its build | the agent |
| `agents/compiles/build/` | built apps, one folder per compile, `latest/` = the newest | the agent + halugraph |
| `process/` | the procedures the agent follows (how to compile, review, write node types) | read it; change it to change how the agent works |
| `tools/` | the agent's connection to halugraph — its command-line client and the MCP server Claude Code and Codex start (`tools/cmd/`) — and their docs (`tools/doc/`) | halugraph |
| `util/` | files of the running halugraph server | halugraph |
| `AGENTS.md` | the agent's operating manual | you, if you want different agent behaviour |
| `.claude/`, `.codex/`, `.mcp.json` | settings for Claude Code and Codex in this folder (which commands the agent may run without asking, and how it connects to halugraph) | you, if you want to change them |
| `.hlg` | marks this folder as a halugraph project (name, description, main graph) | halugraph (e.g. “Set as main graph” in the editor) |

## Good to know

- **Talk to the agent** from the Agent panel: ask questions ("why is my synth silent?"), ask for
  changes ("add a reverb after the filter"), or ask for new node types. It answers in the editor.
- **Attach pictures and sounds to nodes** (Inspector → Attachments, or drop files on a node): a
  sketch or screenshot of the look you want is a *reference* — the agent looks at it while compiling
  but it is not part of the app; a sample, picture or data file can be *embedded* — it ships inside
  the app (e.g. the sound a `media/audio` node plays). **Sketch…** opens a drawing pad.
- **Problems** found while compiling (contradictions, missing wires, guesses the agent had to make)
  appear in the Problems panel — click one to jump to the node.
- **Every compile is kept**: `agents/compiles/<timestamp>/` holds the exact graph that was compiled
  (`input/`), the agent's plan (`plan.md`) and the generated source code (`app/`, a TypeScript
  project with one file per node).
- Sound, microphone, camera and MIDI need a click and/or permission in the browser — the apps ask for
  them when needed.
- **On Windows** the agent needs Git for Windows (Claude Code runs the procedures in Git Bash, its
  Bash tool) and Python 3.8 or newer (python.org — tick *Add python.exe to PATH*). The project's `.gitattributes`
  keeps every file's line endings the same on Windows, macOS and Linux.

Created with halugraph 0.1.0 on 2026-10-02T07:44:32.031Z.
