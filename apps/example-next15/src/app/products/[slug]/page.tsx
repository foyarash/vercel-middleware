import { notFound } from "next/navigation";
import { connection } from "next/server";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
    await connection();
    const { slug } = await params;

    if (slug !== "known") {
        notFound();
    }

    return (
        <div>
            <span>Product {slug}</span>
        </div>
    );
}
