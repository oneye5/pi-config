export class RequestTracker<TResult = unknown> {
  private readonly pending = new Map<
    string,
    {
      resolve: (value: TResult) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  create(id: string, timeoutMs: number): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for response to ${id}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  resolve(id: string, value: TResult): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      return false;
    }

    clearTimeout(entry.timeout);
    this.pending.delete(id);
    entry.resolve(value);
    return true;
  }

  reject(id: string, error: Error): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      return false;
    }

    clearTimeout(entry.timeout);
    this.pending.delete(id);
    entry.reject(error);
    return true;
  }

  rejectAll(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timeout);
      this.pending.delete(id);
      entry.reject(error);
    }
  }
}
