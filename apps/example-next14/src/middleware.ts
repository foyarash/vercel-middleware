import { createRedirectionIoMiddleware } from "@redirection.io/vercel-middleware/next";
import { chainedNextMiddleware, chainedPreviousMiddleware } from "./chained-middlewares";

export default createRedirectionIoMiddleware({
    previousMiddleware: chainedPreviousMiddleware,
    nextMiddleware: chainedNextMiddleware,
});

export const config = {
    unstable_allowDynamic: ["/node_modules/@redirection.io/**"],
    matcher: [
        // Match all pathnames except for
        // - … if they start with `/api`, `/_next` or `/_vercel`
        // - … the ones containing a dot (e.g. `favicon.ico`)
        "/((?!api|_next/static|_next/image|.*\\.png$).*)?",
    ],
};
