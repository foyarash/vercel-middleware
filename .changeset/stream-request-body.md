---
"@redirection.io/vercel-middleware": patch
---

Stop buffering the whole body of every matched request (uploads…) in the middleware: the body is streamed to the deployment only when the request is proxified, and given to chained middlewares as a clone.
