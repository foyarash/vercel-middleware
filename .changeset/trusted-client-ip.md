---
"@redirection.io/vercel-middleware": patch
---

Only use a trusted client IP for the agent and the logs: the `x-real-ip` header set by Vercel when running on Vercel, the socket address in the instrumentation elsewhere (read when the request starts, as it is lost once the connection is closed). A `x-real-ip` header sent by the client is no longer trusted outside Vercel.
