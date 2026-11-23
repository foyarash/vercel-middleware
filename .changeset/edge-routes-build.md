---
"@redirection.io/vercel-middleware": patch
---

Fix the Edge middleware build with Turbopack, which failed on the `process.cwd` and `process.getBuiltinModule` calls used to read the Next.js build manifests, and no longer call them outside the Node.js runtime.
