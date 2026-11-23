import { cookies, headers } from "next/headers";

export default async function ChainedTarget({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
    const { from } = await searchParams;
    const requestHeaders = await headers();
    const requestCookies = await cookies();

    return (
        <dl>
            <dt>from</dt>
            <dd data-testid="from">{from ?? ""}</dd>
            <dt>x-chained-previous</dt>
            <dd data-testid="previous-header">{requestHeaders.get("x-chained-previous") ?? ""}</dd>
            <dt>x-chained-next</dt>
            <dd data-testid="next-header">{requestHeaders.get("x-chained-next") ?? ""}</dd>
            <dt>chained-previous cookie</dt>
            <dd data-testid="previous-cookie">{requestCookies.get("chained-previous")?.value ?? ""}</dd>
        </dl>
    );
}
