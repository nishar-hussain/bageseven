/** Wallet providers may reject with JSON-RPC objects instead of Error instances. */
export function errorMessage(error: unknown, fallback = 'Request failed. Please try again.'): string {
  const seen = new Set<unknown>();
  function read(value: unknown, depth = 0): string | undefined {
    if (depth > 6 || value == null || seen.has(value)) return;
    seen.add(value);
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text || text === '[object Object]') return;
      if (text.startsWith('{')) { try { return read(JSON.parse(text), depth + 1); } catch { /* Plain message. */ } }
      return text;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (Number(record.code) === 4001) return 'Request declined in your wallet. Review the request and try again when ready.';
    if (Number(record.code) === -32002) return 'A request is already pending in your wallet. Open your wallet and review or dismiss it before trying again.';
    if (Number(record.code) === 4100) return 'Your wallet has not authorized this account to sign. Disconnect it using the wallet button, reconnect and approve account access, then try again.';
    for (const key of ['shortMessage', 'message', 'cause', 'error', 'data', 'originalError']) {
      const message = read(record[key], depth + 1);
      if (message) return message;
    }
  }
  return read(error) ?? fallback;
}
