---
"@redirection.io/vercel-middleware": minor
---

Do not send the `cookie`, `authorization`, `proxy-authorization` and `x-api-key` request headers to the redirection.io agent by default. Rules triggered on these headers (including the Basic Auth "Request a password for a folder" recipe) now require `REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS` (comma-separated header names) to keep working.
