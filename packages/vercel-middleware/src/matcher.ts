export const STATIC_ASSET_EXTENSIONS =
    "css|js|mjs|map|json|png|jpe?g|gif|svg|ico|webp|avif|bmp|woff2?|ttf|otf|eot|webmanifest|mp4|webm|mp3";

const DEFAULT_MATCHER_REGEX = `^/(?!api/|_next/|_static/|_vercel)(?!.*\\.(?:${STATIC_ASSET_EXTENSIONS})$).*$`;

export function isPathMatched(pathname: string, matcherRegex: string | null | undefined) {
    const regex = matcherRegex === undefined ? DEFAULT_MATCHER_REGEX : matcherRegex;

    return regex === null || new RegExp(regex).test(pathname);
}
