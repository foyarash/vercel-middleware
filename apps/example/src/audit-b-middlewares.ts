import { NextResponse } from "next/server";

type AuditBRequest = Pick<Request, "url" | "headers"> & {
    nextUrl: { pathname: string; basePath: string; locale: string };
};

const AUDIT_B_PREFIX = "/audit-b-";
const AUDIT_B_TARGET = "/audit-b-target";

export const auditBPreviousMiddleware = (request: AuditBRequest) => {
    const { pathname } = request.nextUrl;

    if (!pathname.startsWith(AUDIT_B_PREFIX) || pathname === AUDIT_B_TARGET) {
        return NextResponse.next();
    }

    const headers = new Headers(request.headers);
    headers.set("x-audit-b-previous", "previous");

    const response = NextResponse.rewrite(
        new URL(`${request.nextUrl.basePath}${AUDIT_B_TARGET}?from=${pathname}`, request.url),
        {
            request: { headers },
        },
    );
    response.cookies.set("audit-b-previous", "previous");
    response.headers.set("x-audit-b-previous-response", "previous");
    response.headers.set(
        "x-audit-b-next-url",
        JSON.stringify({ basePath: request.nextUrl.basePath, locale: request.nextUrl.locale, pathname }),
    );

    return response;
};

export const auditBNextMiddleware = (request: AuditBRequest) => {
    if (request.nextUrl.pathname !== AUDIT_B_TARGET) {
        return NextResponse.next();
    }

    const headers = new Headers(request.headers);
    headers.set("x-audit-b-next", "next");

    const response = NextResponse.next({ request: { headers } });
    response.cookies.set("audit-b-next", "next");
    response.headers.set("x-audit-b-next-response", "next");

    return response;
};
