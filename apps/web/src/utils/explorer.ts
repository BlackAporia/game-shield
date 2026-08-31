export function explorerTxUrl(hash: string, isMainnet: boolean): string {
  return isMainnet
    ? `https://voyager.online/tx/${hash}`
    : `https://sepolia.voyager.online/tx/${hash}`;
}
