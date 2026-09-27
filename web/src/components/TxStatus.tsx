import { explorerTx, type NetworkBlock } from "../config";
import type { TxRecord } from "../hooks/useTransactions";

const PHASE_TEXT: Record<TxRecord["phase"], string> = {
  simulating: "Checking the transaction…",
  signing: "Confirm in your wallet.",
  pending: "Submitted. Waiting for confirmation…",
  confirmed: "Confirmed.",
  failed: "Failed.",
};

interface Props {
  record?: TxRecord;
  network?: NetworkBlock;
  onDismiss: (key: string) => void;
}

/**
 * Per-control transaction status. The container is always rendered so the polite live region
 * exists before its text changes; errors switch to role="alert".
 */
export function TxStatus({ record, network, onDismiss }: Props) {
  const isError = record?.phase === "failed";
  return (
    <div
      className={["tx-status", record ? `is-${record.phase}` : "is-empty"].join(" ")}
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
    >
      {record && (
        <>
          <span className="tx-status-icon" aria-hidden="true">
            {record.phase === "confirmed" ? "✓" : record.phase === "failed" ? "!" : "…"}
          </span>
          <span className="tx-status-text">
            <strong>{record.label}:</strong> {PHASE_TEXT[record.phase]}
            {record.message && ` ${record.message}`}
            {record.hash && (
              <>
                {" "}
                <a href={explorerTx(network, record.hash) ?? "#"} target="_blank" rel="noreferrer">
                  View transaction on explorer
                </a>
              </>
            )}
          </span>
          {(record.phase === "confirmed" || record.phase === "failed") && (
            <button type="button" className="button button-ghost button-small" onClick={() => onDismiss(record.key)}>
              Dismiss
            </button>
          )}
        </>
      )}
    </div>
  );
}
