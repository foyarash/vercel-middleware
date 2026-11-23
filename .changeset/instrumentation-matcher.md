---
"@redirection.io/vercel-middleware": minor
---

The instrumentation now applies the same `matcherRegex` as the middleware: requests excluded by it (such as `/api/*` routes by default) are no longer logged nor sent to the agent. Pass `registerRedirectionIoInstrumentation({ matcherRegex })` to change it. `matcherRegex: null` now also disables the default matcher with the `next` helper.
