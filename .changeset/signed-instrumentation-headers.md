---
"@redirection.io/vercel-middleware": patch
---

Stop trusting client-provided `x-redirectionio-*` request headers in the instrumentation: the middleware now forwards the action and timings through signed request header overrides, bound to the request method, path and query and rejected when older than 60 seconds, and unsigned values are ignored.
