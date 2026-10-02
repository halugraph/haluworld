# agents/notes/ — the agent's notebook

Free-form notes the agent keeps while working on this project, for example:

- `pending.md` — questions asked outside a compile that the user has not answered yet, and what they
  were for (the answer arrives later as an `answer` event);
- research on a technique or library before using it in a compile (e.g. "granular synthesis in Web
  Audio", "three.js post-processing");
- longer explanations prepared for the user (the agent can show them with
  `tools/cmd/halugraph-client dialog --title "<title>" --file agents/notes/<file>.md`);
- anything too long for `agents/memory.md`.

Notes are committed with the project when you save, so they survive restarts. Name files by topic,
in lowercase kebab-case (`audio-latency.md`). Delete notes that are no longer true.
