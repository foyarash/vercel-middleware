---
"@redirection.io/vercel-middleware": patch
---

Read the `set-cookie` headers with `Headers.getSetCookie()` instead of splitting them on commas, which broke cookies with a comma in their value.
