import { describe, expect, it } from 'vitest';
import { newDesign, validateDesign, reactInstall, iframeInstall } from '../lib/builder-model';
import { embedAuthMessage, parentOrigin } from '../lib/embed-auth-message';

describe('billing builder configuration and installation', () => {
  it('defaults to one complete embed and never allows runtime credentials in saved config', () => {
    const draft = newDesign();
    expect(draft.componentId).toBe('cmp_customer');
    const result = validateDesign({ ...draft, token: 'private-customer-token', provider: 'another-account' });
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('provider');
  });
  it('rejects unsupported CSS and plan references before storage or snippet generation', () => {
    expect(() => validateDesign({ ...newDesign(), accent: 'url(https://evil.example)' })).toThrow('color');
    expect(() => validateDesign({ ...newDesign(), planIds: ['../../other-provider'] })).toThrow('plans');
    expect(() => validateDesign({ ...newDesign(), radius: 'expression(x)' })).toThrow('radius');
  });
  it('escapes arbitrary headings in executable React code and excludes customer tokens from iframe URLs', () => {
    const title = 'My "quoted" heading\nwith a newline';
    const snippet = reactInstall({ ...newDesign(), heading: title }, 'https://console.example', 'pk_public');
    expect(snippet).toContain(JSON.stringify(title));
    expect(snippet).toContain('cmp_customer');
    const html = iframeInstall('design-id', 'https://console.example');
    expect(html).not.toContain('&token=');
    expect(html).toContain('event.source !== frame.contentWindow');
    expect(html).toContain('event.origin !== origin');
  });
});
describe('embedded customer authentication channel', () => {
  const parent = {} as Window;
  const event = {
    origin: 'https://app.example',
    source: parent,
    data: { type: 'bagseven:authorize', token: 'scoped-token-value', holder: 'customer' },
  };
  it('accepts only the declared parent window and exact origin', () => {
    expect(parentOrigin('https://app.example')).toBe('https://app.example');
    expect(parentOrigin('https://app.example/path')).toBeNull();
    expect(embedAuthMessage(event, 'https://app.example', parent)?.holder).toBe('customer');
    expect(
      embedAuthMessage({ ...event, origin: 'https://evil.example' }, 'https://app.example', parent),
    ).toBeNull();
    expect(embedAuthMessage({ ...event, source: {} as Window }, 'https://app.example', parent)).toBeNull();
    expect(embedAuthMessage(event, null, parent)).toBeNull();
  });
});
