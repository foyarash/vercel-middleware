---
"@redirection.io/vercel-middleware": patch
---

Stop exposing the `x-redirectionio-action` and timing headers in responses by default; set `REDIRECTIONIO_DEBUG_HEADERS=true` to re-enable them.
