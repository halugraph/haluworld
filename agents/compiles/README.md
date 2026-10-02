# agents/compiles/ — compiles, builds and the shared toolchain

Every time you press **Compile**, halugraph creates a folder named after the time of the request
(`YYYYMMDD-HHMMSS`, local time) and the agent turns the graph into an app there
(procedure: `process/compile.md`).

```
<id>/input/          snapshot of .hlg, graphs/ and nodes/ at compile time (halugraph; read-only)
<id>/compile.json    the compile record: graph, state, times, summary (halugraph)
<id>/plan.md         the agent's reading of your graph: node → module map, assumptions, questions
<id>/app/            the generated Vite + TypeScript project — src/nodes/<graph>/<nodeId>.ts is one file per node
<id>/build.log       output of the build
build/<id>/          the built app (index.html + assets), served at /preview/<id>/ on the preview origin
build/latest/        copy of the newest successful build (/preview/latest/ serves the last finished build)
package.json         the shared toolchain (vite + typescript + libraries the apps use)
node_modules/        installed once by the agent (npm install here); not committed
```

- `build/` and `node_modules/` are ignored by git; the compile folders (inputs, plans, sources) are
  kept, so you can always see what was compiled and what was generated from it.
- The apps are TypeScript. They have no `node_modules` of their own: Vite and TypeScript find the
  toolchain here by walking up the folder tree. The agent checks every app for type errors before it
  builds it; inside an app folder, `npm run typecheck` does the same for you, `npm run dev` starts a
  live-reloading dev server and `npm run build` builds into `app/dist/` (ignored by git).
- Old compile folders can be deleted when you no longer need them (keep the latest successful one:
  the agent reuses unchanged node modules from it).
- To run a build outside halugraph, serve `build/<id>/` with any static web server — all URLs in it are
  relative.
