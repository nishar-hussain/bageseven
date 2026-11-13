/** Normalize return paths before using them in server or browser navigation. */
export function appDestination(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app';
  try {
    const url = new URL(value, 'https://bagseven.invalid');
    if (
      url.origin !== 'https://bagseven.invalid' ||
      (url.pathname !== '/app' && !url.pathname.startsWith('/app/'))
    )
      return '/app';
    if (/^\/app\/(login|onboarding)(\/|$)/.test(url.pathname)) return '/app';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/app';
  }
}
