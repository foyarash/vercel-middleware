import { connection } from "next/server";

export default async function DynamicPage() {
    await connection();

    return (
        <div>
            <span>Rendered at {new Date().toISOString()}</span>
        </div>
    );
}
