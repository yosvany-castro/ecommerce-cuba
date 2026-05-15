export async function waitFor<T>(
  fn: () => Promise<T>,
  opts: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const timeout = opts.timeout ?? 2000;
  const interval = opts.interval ?? 50;
  const deadline = Date.now() + timeout;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  throw lastErr ?? new Error("waitFor timeout");
}
