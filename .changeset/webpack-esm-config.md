---
"@redirection.io/vercel-middleware": patch
---

Fix the import of `@redirection.io/vercel-middleware/webpack` from an ES module Next config (`next.config.mjs`): the `import` export pointed to a missing `webpack.mjs` file and the module relied on `__dirname`.
