import { describe, it, expect } from 'vitest';

describe('API package structure', () => {
  it('exports buildApp', async () => {
    const { buildApp } = await import('../src/index.js');
    expect(typeof buildApp).toBe('function');
  });

  it('exports config parseEnv', async () => {
    const { parseEnv } = await import('../src/config.js');
    expect(typeof parseEnv).toBe('function');
  });

  it('exports services', async () => {
    const { Services } = await import('../src/services/index.js');
    expect(typeof Services).toBe('function');
  });
});
