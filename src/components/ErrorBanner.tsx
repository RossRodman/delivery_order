export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-danger-500 bg-danger-100 px-4 py-3 text-body text-danger-900"
    >
      {message}
    </div>
  );
}
