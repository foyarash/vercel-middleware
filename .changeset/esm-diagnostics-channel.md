---
"@redirection.io/vercel-middleware": patch
---

Load `node:diagnostics_channel` with a dynamic `import()` in the instrumentation instead of `require()`, which is not defined in the ES module build.
