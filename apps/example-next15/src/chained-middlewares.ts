import { NextResponse } from "next/server";

type ChainedRequest = Pick<Request, "url" | "headers"> & {
    nextUrl: { pathname: string; basePath: string; locale: string };
};

const CHAINED_PREFIX = "/chained-";
const CHAINED_TARGET = "/chained-target";

export const chainedPreviousMiddleware = (request: ChainedRequest) => {
    const { pathname } = request.nextUrl;

    if (!pathname.startsWith(CHAINED_PREFIX) || pathname === CHAINED_TARGET) {
        return NextResponse.next();
    }

    const headers = new Headers(request.headers);
    headers.set("x-chained-previous", "previous");

    const response = NextResponse.rewrite(
        new URL(`${request.nextUrl.basePath}${CHAINED_TARGET}?from=${pathname}`, request.url),
        {
            request: { headers },
        },
    );
    response.cookies.set("chained-previous", "previous");
    response.headers.set("x-chained-previous-response", "previous");
    response.headers.set(
        "x-chained-next-url",
        JSON.stringify({ basePath: request.nextUrl.basePath, locale: request.nextUrl.locale, pathname }),
    );

    return response;
};

export const chainedNextMiddleware = (request: ChainedRequest) => {
    if (request.nextUrl.pathname !== CHAINED_TARGET) {
        return NextResponse.next();
    }

    const headers = new Headers(request.headers);
    headers.set("x-chained-next", "next");

    const response = NextResponse.next({ request: { headers } });
    response.cookies.set("chained-next", "next");
    response.headers.set("x-chained-next-response", "next");

    return response;
};
