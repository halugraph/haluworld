// Vite config for a halugraph-generated app.
// No imports on purpose: the toolchain lives in agents/compiles/node_modules and is found by walking up.
// base './' keeps every URL relative, so the build works under any sub-path (/preview/<id>/, /preview/latest/).
// Not part of the type-checked program (tsconfig.json includes src/ only); Vite strips its types itself.
export default {
  base: './',
  build: {
    // Bundled libraries (three.js, tone.js…) are big; that is fine for a local preview.
    chunkSizeWarningLimit: 4096,
  },
  server: {
    host: '127.0.0.1',
  },
};
