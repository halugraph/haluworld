# agents/ — the compiler agent's workspace

Everything the AI agent (Claude Code, following `AGENTS.md`) writes lives here. You can read all of it;
the agent keeps it tidy.

| path | what |
|---|---|
| `memory.md` | long-term memory: what the agent understood about the project, your preferences, decisions, lessons. Read at startup, updated after every task. Edit it if the agent remembers something wrong. |
| `notes/` | free-form notes: research, longer explanations, pending questions. |
| `tmp/` | scratch space; ignored by git (except its README). |
| `compiles/` | one folder per compile (`<timestamp>/`), the shared build toolchain, and the built apps (`build/`). See `compiles/README.md`. |

Rules for the agent:
- Never touch `compiles/<id>/input/` (halugraph's snapshot of what was compiled) or
  `compiles/<id>/compile.json` (the compile record).
- Memory stays short and structured; long material goes to `notes/`.
- Scratch files go to `tmp/`, never into the project root.
