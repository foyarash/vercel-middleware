---
"@redirection.io/vercel-middleware": patch
---

Load `node:diagnostics_channel` with `process.getBuiltinModule()` in the instrumentation when `require()` is not defined (ES module build loaded without a bundler), without making Next.js warn about a Node.js module in the Edge instrumentation bundle.
