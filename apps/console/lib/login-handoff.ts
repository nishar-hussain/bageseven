/** Observe the same-origin session; the email callback may finish in another tab. */
export function watchLoginSession(onAuthenticated: () => void): () => void {
  let stopped = false;
  let checking = false;
  let controller: AbortController | undefined;
  const check = async () => {
    if (stopped || checking || document.visibilityState === 'hidden') return;
    checking = true;
    controller = new AbortController();
    const timeout = window.setTimeout(() => controller?.abort(), 6000);
    try {
      const response = await fetch('/api/me', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const me = response.ok
        ? ((await response.json()) as { email_verified?: boolean; mock?: boolean })
        : null;
      if (!stopped && me?.email_verified && !me.mock) {
        stopped = true;
        onAuthenticated();
      }
    } catch {
      /* Offline or still signed out: keep the form usable and retry on focus. */
    } finally {
      window.clearTimeout(timeout);
      checking = false;
    }
  };
  const focus = () => {
    void check();
  };
  window.addEventListener('focus', focus);
  window.addEventListener('pageshow', focus);
  document.addEventListener('visibilitychange', focus);
  const interval = window.setInterval(focus, 3000);
  void check();
  return () => {
    stopped = true;
    controller?.abort();
    window.clearInterval(interval);
    window.removeEventListener('focus', focus);
    window.removeEventListener('pageshow', focus);
    document.removeEventListener('visibilitychange', focus);
  };
}
