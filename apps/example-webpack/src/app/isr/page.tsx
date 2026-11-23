export const revalidate = 30;

export default async function IsrPage() {
    return (
        <div>
            <span>Generated at {new Date().toISOString()}</span>
        </div>
    );
}
