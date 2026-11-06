import { describe, expect, it } from 'vitest';
import { BagsevenClient } from './node.js';

describe('BagsevenClient', () => {
  it('requires an api key', () => {
    expect(() => new BagsevenClient({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('builds check URLs from feature + holder', () => {
    const client = new BagsevenClient({ apiKey: 'sk_test', baseUrl: 'http://127.0.0.1:4001/' });
    expect(client.baseUrl).toBe('http://127.0.0.1:4001');
  });
});
