# haluworld

**The halugraph showcase:** four audiovisual worlds, patched as graphs and compiled into a web app by an AI agent.

* **Neon Drive:** a synthwave night drive.
* **Aurora:** a calm pad under shimmering curtains.
* **Firefly Garden:** fireflies that follow your pointer and sing when you tap.
* **Crystal Cave:** bells and a gong in a 3D geode.

Leave it alone for 20 seconds and **attract mode** tours the worlds by itself.
Keys: **1–4** pick a world · **← / →** previous / next · **space** tap · **A** attract mode.

This repository is a **halugraph project**. You build a web app by patching nodes into graphs (like VVVV or
plugdata) and describing in plain words what each node should do. An AI agent (Claude Code or Codex) is the
compiler: it reads the graphs and writes a real single-page web app, which you try right away in the Preview.
The graphs are the source: `graphs/main.yml` (the director, the stage, the HUD and the master bus),
`graphs/worlds/*.yml` (one subgraph per world), and `graphs/worlds/lib/` (a plucked voice used 5× and an echo +
hall used 3×).

## Open it on halugraph.com

[halugraph.com](https://halugraph.com) runs halugraph for you: the editor, your own workspace with the agent,
and the previews, all in the browser.

1. **Sign in** at https://halugraph.com and you land on your dashboard.
2. **Make the project.** Either:
   * **New project** → template **haluworld**. The dashboard copies this repository into your workspace as a
     new project, with its history and without a remote. Or:
   * open any of your projects, open a terminal tab (`` Ctrl+Shift+` ``) and clone it yourself:

     ```bash
     git clone https://github.com/halugraph/haluworld.git ~/projects/haluworld
     git -C ~/projects/haluworld remote remove origin
     ```

     Every folder in `~/projects` with a `.hlg` file shows up on the dashboard (reload it).
3. **Open it**: `https://halugraph.com/<your login>/haluworld/`.
4. **Start the agent**: **Start agent** (Agent panel or status bar) → **Claude Code** or **Codex**. The first
   time, you sign in to your own account in that terminal tab: Claude Code prints a link to open, and Codex
   needs `codex login --device-auth`. The sign-in stays in your workspace.
5. **Compile**: press **F5**. The agent writes the app from the graphs. The first compile of this project
   takes a while: four worlds, two shaders, four three.js scenes. The **Preview** panel shows the result
   and reloads after every compile.
6. **Click into the preview once**: browsers start sound only after a click or tap. The preview's address (URL
   bar of the Preview panel) works on your phone too. It is a private link: whoever has it can open your
   builds while the project is open.

**Change it**: edit a node's text in the Inspector, rewire, add a world, then **Ctrl+S** (every save is a git
commit) and **F5**. Or ask the agent in the Agent panel ("make Aurora's pad warmer", "add a fifth world").

**Keep it on GitHub**: create an empty repository, press **Push** and paste its address. The first time, set up
your git sign-in in a terminal tab: a personal access token, or an SSH key. halugraph's **Help → Documentation →
halugraph.com** says how.

## Run it on your own computer

You need Node.js 22 or newer, git, Python 3.8 or newer, halugraph, and Claude Code or Codex.

```bash
git clone https://github.com/halugraph/haluworld.git haluworld
halugraph haluworld        # opens the editor at http://127.0.0.1:4747/
```

Then **Start agent** in the editor, or run `claude` (or `codex`) in the folder yourself and tell it **Read
AGENTS.md and strictly follow it.** The first time, answer *yes* when it asks whether you trust this folder:
that turns on the folder's settings (`.claude/`, `.codex/`, `.mcp.json`). Press **F5** to compile; the app
appears in the Preview panel and at `http://127.0.0.1:4748/preview/latest/`.

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
