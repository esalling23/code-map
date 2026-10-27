export class Ledger {
  private entries: number[] = [];

  /** Records an amount in the ledger. */
  record(amount: number) {
    this.entries.push(amount);
    log(amount);
  }
}

export function audit(event: string) {
  log(event);
}

function log(value: unknown) {
  console.log(value);
}
