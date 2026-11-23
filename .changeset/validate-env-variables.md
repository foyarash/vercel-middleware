---
"@redirection.io/vercel-middleware": patch
---

Validate the environment variables: an invalid `REDIRECTIONIO_TIMEOUT` (not a positive integer), boolean (other than `true`/`false`) or header list now logs a warning and falls back to the default value, instead of making every agent request time out immediately.
