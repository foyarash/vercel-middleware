---
"@redirection.io/vercel-middleware": patch
---

Stop trusting client-provided `x-redirectionio-*` request headers in the instrumentation: the middleware now forwards the action and timings through signed request header overrides, and unsigned values are ignored.
