export function ActionBar({
  canSave,
  canRequestApproval,
  isPendingApproval,
  isOffline,
  saving,
  onSave,
  onRequestApproval,
  onWithdraw,
}: {
  canSave: boolean;
  canRequestApproval: boolean;
  isPendingApproval: boolean;
  isOffline?: boolean;
  saving?: boolean;
  onSave: () => void;
  onRequestApproval: () => void;
  onWithdraw?: () => void;
}) {
  return (
    <div className="sticky bottom-0 flex items-center justify-between border-t border-border-default bg-bg-surface p-4">
      <div>
        {isPendingApproval ? (
          <span className="text-body text-text-secondary">Awaiting approval</span>
        ) : (
          canRequestApproval && (
            <button
              type="button"
              onClick={onRequestApproval}
              className="focus-ring rounded-md border border-brand-600 px-4 py-2 text-body text-brand-600"
            >
              Request approval
            </button>
          )
        )}
        {isPendingApproval && onWithdraw && (
          <button type="button" onClick={onWithdraw} className="focus-ring ml-3 text-small text-brand-600 hover:underline">
            Cancel request
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave || saving}
        title={!canSave ? "Resolve blocked lines or request approval first" : undefined}
        className="focus-ring rounded-md bg-brand-600 px-4 py-2 text-body text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : isOffline ? "Save (offline)" : "Save order"}
      </button>
    </div>
  );
}
