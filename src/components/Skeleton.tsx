export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 w-full animate-pulse rounded-md bg-blocked-100" />
      ))}
    </div>
  );
}
