export const dynamic = "force-dynamic";

export default async function DynamicPage() {
    return (
        <div>
            <span>Rendered at {new Date().toISOString()}</span>
        </div>
    );
}
