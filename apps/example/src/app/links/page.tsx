import Link from "next/link";

export default function Links() {
    return (
        <nav>
            <Link href="/test-redirect" data-testid="redirected-link">
                Redirected link
            </Link>
            <Link href="/test-temp-redirect" data-testid="temp-redirected-link">
                Temporarily redirected link
            </Link>
            <Link href="/" data-testid="home-link">
                Home link
            </Link>
        </nav>
    );
}
