import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: { slug: string } }) {
    const { slug } = params;

    if (slug !== "known") {
        notFound();
    }

    return (
        <div>
            <span>Product {slug}</span>
        </div>
    );
}
