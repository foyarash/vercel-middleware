---
"@redirection.io/vercel-middleware": patch
---

Send the real version of the library in the `User-Agent` of the agent requests and in the `proxy` field of the logs (`redirection-io-vercel-middleware/<version>`), instead of a hard-coded `0.5.2` prefixed twice with `vercel-edge-middleware/`.
