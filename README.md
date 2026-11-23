# Vercel Edge Middleware for redirection.io

This package allows to use redirection.io within
a [Vercel Edge Middleware](https://vercel.com/docs/functions/edge-middleware).

Look at our documentation about our Vercel Edge Middleware integration
here: [https://redirection.io/documentation/developer-documentation/vercel-middleware-integration](https://redirection.io/documentation/developer-documentation/vercel-middleware-integration)

## Installation

```bash
npm install @redirection.io/vercel-middleware

// or with yarn
yarn add @redirection.io/vercel-middleware
```

## Usage

Create a `middleware.ts` (or `proxy.ts` depending on your Next.js version) file in the root of your Vercel application (at the same level as the `app` or `pages` folders,
possibly in a `src` folder if your project uses one) with the following content:

> For Next.js usage, see [the Next.js section](#nextjs)

```typescript
import redirectionioMiddleware from "@redirection.io/vercel-middleware";

export default redirectionioMiddleware;

export const config = {
    unstable_allowDynamic: ["/node_modules/@redirection.io/**"],
};
```

Set the `REDIRECTIONIO_TOKEN` environment variable in your vercel project settings.

To debug the middleware, set `REDIRECTIONIO_DEBUG_HEADERS=true`: responses will then include the `x-redirectionio-action`, `x-redirectionio-start-time`, `x-redirectionio-action-match-time` and `x-redirectionio-proxy-response-time` headers. They are not sent by default, as they expose internal rule details to visitors.

Then create a `instrumentation.ts` file in the same folder as the `proxy.ts` file with the following content:

```typescript
import { registerRedirectionIoInstrumentation } from "@redirection.io/vercel-middleware/instrumentation";

export const register = async () => {
  registerRedirectionIoInstrumentation();
};
```

The middleware forwards the redirection.io action and its timings to the instrumentation through Next.js request header
overrides (`x-middleware-override-headers`), signed with an HMAC-SHA256 of the `REDIRECTIONIO_TOKEN` bound to the
request method, path and query, and only accepted for 60 seconds. The
instrumentation ignores any `x-redirectionio-*` request header without a valid signature (for example one sent by a
client) and fetches the action itself instead. Both runtimes therefore need the same `REDIRECTIONIO_TOKEN` and access to
the Web Crypto API (`crypto.subtle`, available on Node.js 20+).

### Redirections

With Next.js, the `Location` header of a redirection to the same host is relative (for example
`Location: /new-page`): Next.js rewrites any same-origin `Location` returned by a middleware/proxy relative to the
request, locally and on Vercel. This is allowed by [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#field.location)
and followed by browsers and HTTP clients. The logs keep the absolute target URL.

### Logging

Each request handled by redirection.io is logged exactly once, in the background with `waitUntil`:

-   when the middleware produces the final response itself (redirection, custom status such as a `410`, or a response
    proxified to apply headers or body filters), the middleware sends the log;
-   when the middleware lets the request through (`next()` or a rewrite) to a page that Next.js serves without running a
    function (static page, ISR page, or the static 404 page for an unknown URL), the middleware sends the log with the
    status of that page: these pages are served from the Vercel CDN cache and never reach the instrumentation;
-   when the middleware lets the request through to a dynamic route (server-rendered page, route handler), the
    instrumentation sends the log once the function answered, with its real status code (for example a `404` returned
    by `notFound()`);
-   requests excluded by the `matcherRegex` (for example `/api/*` routes with the default one) are neither handled nor
    logged.

The instrumentation applies the same default `matcherRegex` as the middleware. If you change it in the middleware, pass
the same value to the instrumentation:

```typescript
registerRedirectionIoInstrumentation({ matcherRegex: null }); // log every route, API routes included
```

To tell static pages from dynamic routes, a Node.js middleware (Next.js 16 `proxy.ts`, or `runtime: "nodejs"`) reads
the Next.js build manifests (`.next/prerender-manifest.json`, `.next/app-path-routes-manifest.json`,
`.next/server/pages-manifest.json`, `.next/routes-manifest.json`) once, from the working directory. When they cannot
be read (Edge runtime, custom `distDir`, i18n routing, `beforeFiles` rewrites), the requests let through are logged by
the instrumentation only, so pages served from the CDN cache are not logged. With other rewrites in `next.config`,
only prerendered pages are logged by the middleware. ISR pages with a dynamic segment that are not prerendered yet are
logged with a `200` status.

The instrumentation ignores the Vercel internal requests (`/_vercel/*`, ISR renders requested by the Vercel cache) and
the invocation of a Node.js middleware, which runs in its own function on Vercel. With `logged: false`, neither the
middleware nor the instrumentation logs the requests handled by the middleware.

### Proxified responses

When a rule has to alter the backend response (response headers, body filters), the middleware fetches the page from
the deployment itself (one extra function invocation) with the headers of the client request and a signed marker that
prevents a loop. The client IP (`x-forwarded-for`, `x-real-ip`) is kept, and with Vercel Deployment Protection the
client credentials (`_vercel_jwt` cookie, `x-vercel-protection-bypass` header) are reused, so a visitor allowed to see
a protected preview also gets the proxified page; no bypass secret is added by the middleware.

Then, deploy your project to Vercel.

```bash
vercel deploy
```

### Sensitive request headers

By default, the `cookie`, `authorization`, `proxy-authorization` and `x-api-key` request headers are never sent to the redirection.io agent.

> **Breaking change:** rules using a request header trigger on one of these headers (for example a rule matching a `cookie` value, or the "Request a password for a folder" Basic Auth recipe, which relies on `authorization`) no longer match unless you opt in.

To forward some of them, set the `REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS` environment variable to a comma-separated list of header names:

```bash
REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS=cookie,authorization
```

### Response encoding

When the middleware proxies a request to your backend, `fetch()` decodes the response body, so the `content-encoding` and `content-length` headers are removed from the proxied response. They are also removed when a rule filters the body (custom HTML, SEO override…). Your platform can still compress the final response.

## Usage with an existing middleware

You may have an existing middleware in your Vercel project. In this case, you can use
the `createRedirectionIoMiddleware` function which allows to chain existing middleware with redirection.io middleware.

```typescript
import { createRedirectionIoMiddleware } from "@redirection.io/vercel-middleware";

const myExistingMiddleware = (request: Request) => {
    // Your existing middleware logic

    return next();
};

const middleware = createRedirectionIoMiddleware({
    previousMiddleware: myExistingMiddleware, // In this case your middleware is executed before redirection.io middleware
    nextMiddleware: myExistingMiddleware, // In this case your middleware is executed after redirection.io middleware
    // Optional: matcher to specify which routes should be ignored by redirection.io middleware
    // Default: "^/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)$"
    matcherRegex: "^/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)$",
    // Optional: If light, redirection.io middleware will only redirect and not override the response
    // Default: "full"
    mode: "light",
    // Optional: If true, redirection.io middleware will log information in Redirection.io
    // Default: true
    logged: true,
});

export default middleware;
```

By default, our middleware ignores certain routes even if there's an exported configuration. The ignored routes are:

-   `/api/*` routes
-   `/next/*` (Next.js internals)
-   `/static/*` (inside `/public`)
-   all root files inside /public (e.g. /favicon.ico)

If you want the middleware to handle all routes without any exclusions, you can set the `matcherRegex` option to `null`:

```typescript
createRedirectionIoMiddleware({ matcherRegex: null });
```

Here's a summary of the middleware options:

| Option               | Type              | Description                                                                                              |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `previousMiddleware` | Function          | Middleware to be executed before redirection.io middleware                                               |
| `nextMiddleware`     | Function          | Middleware to be executed after redirection.io middleware                                                |
| `matcherRegex`       | String or null    | Regex to specify which routes should be handled by redirection.io middleware                             |
| `logged`             | Boolean           | Whether the requests handled by the middleware are logged in redirection.io (default: `true`)            |

When chaining middlewares, redirection.io rules are always matched against the public URL of the request, even if
`previousMiddleware` rewrites it. The final response keeps what the chained middlewares set: the rewrite
(`NextResponse.rewrite`), the overridden request headers (`NextResponse.next({ request: { headers } })`), the cookies
(`response.cookies.set`) and any other response header. A `previousMiddleware` returning a status other than `200`
(e.g. a redirection) still short-circuits redirection.io.

## Next.js

If you are using next.js middlewares, you can use the `createRedirectionIoMiddleware` method
from `@redirection.io/vercel-middleware/next` which is compatible with `NextRequest` type.

```diff
- import { createRedirectionIoMiddleware } from "@redirection.io/vercel-middleware";
+ import { createRedirectionIoMiddleware } from "@redirection.io/vercel-middleware/next";
+ import { NextRequest } from "next/server";

- const myExistingMiddleware = (request: Request) => {
+ const myExistingMiddleware = (request: NextRequest) => {
    return next();
};

```

The `NextRequest` given to `previousMiddleware` and `nextMiddleware` is built with the Next.js config of the original
request (`basePath`, `i18n`, `trailingSlash`), so `request.nextUrl.basePath`, `request.nextUrl.locale` and
`request.nextUrl.pathname` match what Next.js gives to your own middleware.

### Client-side navigations and prefetches

Redirections and blocking rules also apply to client-side navigations (`<Link>`, `router.push`) and to `<Link>` prefetches: the agent is called for these React Server Components requests, so a prefetched link that is redirected lands on the redirection target when clicked. Rules that need the backend response (body or header rewriting) are never applied to these requests, the response is left to Next.js. Server actions (`Next-Action` requests) are never handled by the middleware.

Prefetch requests are not logged in redirection.io. The internal `_rsc` query parameter is removed from the URL sent to the agent and from the logs.

By default, Next.js removes the RSC headers (`RSC`, `Next-Router-Prefetch`, `Next-Router-State-Tree`...) and the `_rsc` parameter before running the middleware/proxy, so these requests cannot be told apart from page requests there: rules that need the backend response may then return HTML to a client navigation, which makes Next.js fall back to a full page load. Set `skipProxyUrlNormalize: true` (`skipMiddlewareUrlNormalize` before Next.js 16) in your Next config to let the middleware detect them.

### Webpack

If you are using Webpack in your Next.js application, you will need to add the following in your Next config :

```typescript
import { redirectionIoWebpackWasmRule } from "@redirection.io/vercel-middleware/webpack";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.module.rules.push(redirectionIoWebpackWasmRule);
    }

    return config;
  },
};
```

### Development

Run the example apps and the lib compilation :

```bash
yarn dev
```

Before making a PR, run `yarn changeset` and select the packages to update. If your changes are not related to a lib update, simply run `yarn changeset add --empty`.
