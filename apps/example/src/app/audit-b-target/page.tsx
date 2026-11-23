import { cookies, headers } from "next/headers";

export default async function AuditBTarget({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
    const { from } = await searchParams;
    const requestHeaders = await headers();
    const requestCookies = await cookies();

    return (
        <dl>
            <dt>from</dt>
            <dd data-testid="from">{from ?? ""}</dd>
            <dt>x-audit-b-previous</dt>
            <dd data-testid="previous-header">{requestHeaders.get("x-audit-b-previous") ?? ""}</dd>
            <dt>x-audit-b-next</dt>
            <dd data-testid="next-header">{requestHeaders.get("x-audit-b-next") ?? ""}</dd>
            <dt>audit-b-previous cookie</dt>
            <dd data-testid="previous-cookie">{requestCookies.get("audit-b-previous")?.value ?? ""}</dd>
        </dl>
    );
}
