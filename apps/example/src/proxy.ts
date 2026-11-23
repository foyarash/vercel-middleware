import { createRedirectionIoMiddleware } from "@redirection.io/vercel-middleware/next";
import { auditBNextMiddleware, auditBPreviousMiddleware } from "./audit-b-middlewares";

export default createRedirectionIoMiddleware({
    previousMiddleware: auditBPreviousMiddleware,
    nextMiddleware: auditBNextMiddleware,
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
