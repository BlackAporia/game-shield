import styles from "../../uni.module.css";
import type { ActionResult } from "../../types";
import { explorerTxUrl } from "../../../utils/explorer";

export default function ResultCard({ r, isMainnet }: { r: ActionResult; isMainnet: boolean }) {
  return (
    <div
      className={`${styles.receipt} ${
        r.status === "error"
          ? styles.receiptError
          : r.status === "pending"
            ? styles.receiptPending
            : styles.receiptOk
      }`}
    >
      <div className={styles.receiptHead}>
        <span className={styles.receiptIcon}>
          {r.status === "ok" ? "✓" : r.status === "error" ? "!" : "⋯"}
        </span>
        <span>{r.title}</span>
      </div>
      {r.rows?.length ? (
        <div className={styles.receiptRows}>
          {r.rows.map((row) => (
            <div key={row.label} className={styles.receiptRow}>
              <span className={styles.receiptLabel}>{row.label}</span>
              {row.hash ? (
                <a className={styles.receiptLink} href={explorerTxUrl(row.hash, isMainnet)} target="_blank" rel="noreferrer">
                  {row.value} ↗
                </a>
              ) : (
                <span className={styles.receiptValue}>{row.value}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {r.note ? <pre className={styles.receiptNote}>{r.note}</pre> : null}
    </div>
  );
}
