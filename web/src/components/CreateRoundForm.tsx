import { useState, type FormEvent } from "react";
import type { Deployment, NetworkBlock } from "../config";
import type { TxRunner } from "../hooks/useTransactions";
import { localInputToUnix, unixToLocalInput } from "../lib/format";
import { describedIds, Field, Select, TextInput } from "./Field";
import { TxStatus } from "./TxStatus";

interface Props {
  deployment: Deployment;
  network?: NetworkBlock;
  tx: TxRunner;
  ready: boolean;
  readyText?: string;
  /** Latest block timestamp, to validate the start time against chain time. */
  chainNow?: bigint;
}

const DAY = 86_400n;

/** createRound(start, end): anyone; start now or later; duration 1 to 30 days. */
export function CreateRoundForm({ deployment, network, tx, ready, readyText, chainNow }: Props) {
  const defaultStart = unixToLocalInput(Math.floor(Date.now() / 1000) + 15 * 60);
  const [start, setStart] = useState(defaultStart);
  const [days, setDays] = useState("7");
  const [error, setError] = useState<string | undefined>();
  const key = "create-round";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const startUnix = localInputToUnix(start);
    const now = chainNow ?? BigInt(Math.floor(Date.now() / 1000));
    if (startUnix === undefined) {
      setError("Choose a start date and time.");
      return;
    }
    if (startUnix < now) {
      setError("Choose a start time that is still in the future when the transaction is mined.");
      return;
    }
    const duration = BigInt(days) * DAY;
    if (duration < DAY || duration > 30n * DAY) {
      setError("Choose a duration between 1 and 30 days.");
      return;
    }
    setError(undefined);
    const ok = await tx.run({
      key,
      label: `Create a ${days}-day round`,
      address: deployment.funding.address,
      abi: deployment.abis[deployment.funding.name],
      functionName: "createRound",
      args: [startUnix, startUnix + duration],
    });
    if (ok) setStart(unixToLocalInput(Math.floor(Date.now() / 1000) + 15 * 60));
  };

  return (
    <form className="action-form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="create-h">
      <p className="action-description">
        Anyone can open a round. As its creator you alone register the projects; anyone can fund the matching
        pool before the end and contribute to projects while the round is open.
      </p>
      <div className="form-row">
        <Field
          id="round-start"
          label="Start (local time)"
          hint="Must still be in the future when the transaction is mined. A few minutes of margin is enough."
          error={error}
        >
          <TextInput
            id="round-start"
            type="datetime-local"
            value={start}
            invalid={!!error}
            describedBy={describedIds("round-start", true, !!error)}
            onChange={(e) => {
              setStart(e.target.value);
              if (error) setError(undefined);
            }}
            disabled={!ready}
          />
        </Field>
        <Field id="round-days" label="Duration" hint="Between 1 and 30 days.">
          <Select
            id="round-days"
            value={days}
            describedBy={describedIds("round-days", true, false)}
            onChange={(e) => setDays(e.target.value)}
            disabled={!ready}
          >
            {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)}>
                {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="steps">
        <button type="submit" className="button button-primary" disabled={!ready || tx.busy(key)}>
          {tx.busy(key) ? "Creating…" : "Create round"}
        </button>
      </div>
      {!ready && readyText && <p className="action-note">{readyText}</p>}
      <TxStatus record={tx.records[key]} network={network} onDismiss={tx.dismiss} />
    </form>
  );
}
