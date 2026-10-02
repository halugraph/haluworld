# Memory — haluworld

> Long-term memory of the compiler agent. Read it at startup; update it after every compile or
> meaningful conversation. Keep entries short and dated; move long material to `agents/notes/`.
> The user may edit this file — their edits win.

## Project understanding

- What the user is building: A vibrant demonstration of what halugraph can do
- Entry graph: `main` (see `.hlg`)
- Important graphs and what they are for:
  - `main` — shell: director (freeform, attract mode), stage (crossfade), hud, dock, master bus
  - `worlds/neon-drive`, `worlds/aurora`, `worlds/firefly-garden`, `worlds/crystal-cave` — the 4 worlds (interface: active, x, y, tap → element, signal)
  - `worlds/lib/pluck` (voice, 5 uses), `worlds/lib/space-fx` (echo+hall, 3 uses)

## User preferences

- Look & feel: wants an impressive, animated, audiovisual showcase (demo for halugraph itself)
- Interaction / controls:
- Communication (how much to ask, level of detail, language):

## Decisions

<!-- One line each: YYYY-MM-DD — decision — why. Decisions hold for future compiles until the user changes them. -->
- 2026-10-02 — Authored the multi-world showcase graphs on user request (the graphs on disk are the truth once the user edits them).
- 2026-10-02 — No blocking click-to-start overlay (it would hide attract mode); HUD shows a "tap to wake the sound" pill instead.
- 2026-10-02 — Each world fades its own audio (tween on active) and pauses its clock when hidden; director owns attract mode (22 s per world, 20 s idle → attract).

## Lessons

<!-- Things that went wrong and how they were fixed (build errors, browser quirks, misunderstandings). -->
- GLSL syntax can be checked offline with @shaderfrog/glsl-parser in the scratchpad (failOnWarn:false; built-ins are warnings).
- 12 modules need real hand-written code (director, stage, hud, app, drums, 2 shaders, swarm, 4 three.js scenes); the rest follow the node types.
- `app.state.get('k', false)` infers literal type `false` → write `get<boolean>(…)`.
- Analyser `level` is RMS (~0..0.25 for music): scale ×3–4 before using it as a 0..1 glow.
- Avoid reversed-edge smoothstep in GLSL (undefined per spec): use 1.0 - smoothstep(lo, hi, x).
- Shader worlds (Neon, Aurora) were black when fully shown and visible only during fades: Chrome draws a WebGL canvas with alpha:true + premultipliedAlpha:false black when its layer is not animated. Use opaque contexts (alpha:false), `will-change: transform` on the world canvases, deterministic stage transitions (inline end states, fill:'none') and context-loss recovery.

## Open threads

<!-- Pending questions, ideas the user mentioned for later, known gaps in the current build. -->
- Expect visual/audio tuning requests after a compile (brightness of 3D lights, mix levels, shader looks).
