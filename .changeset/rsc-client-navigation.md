---
"@redirection.io/vercel-middleware": patch
---

Detect React Server Components requests (`RSC`, `Next-Router-Prefetch`, `Next-Router-Segment-Prefetch`, `Next-Router-State-Tree` headers, `_rsc` parameter): redirections still apply to client-side navigations and prefetches but they are never proxified nor body-filtered, the `_rsc` parameter is no longer sent to the agent, prefetches are no longer logged, and the instrumentation no longer requests the action a second time for each RSC request.
