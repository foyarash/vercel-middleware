---
"@redirection.io/vercel-middleware": patch
---

Abort the requests to the redirection.io agent when they time out (`REDIRECTIONIO_TIMEOUT` for the action, 5 seconds for the log) instead of leaving them and their timer running, and ignore error responses of the agent (401, 403, 429, 5xx…) with a clear error message instead of building an action from their body.
