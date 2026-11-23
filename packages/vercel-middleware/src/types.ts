import { NextFetchEvent, NextRequest } from "next/server";

export type RequestContext = {
    waitUntil(promise: Promise<unknown>): void;
};

export type Middleware<R extends Request = Request, C extends RequestContext = RequestContext> = (
    request: R,
    context?: C,
) => Response | Promise<Response>;

export type NextMiddleware = Middleware<NextRequest, NextFetchEvent>;
