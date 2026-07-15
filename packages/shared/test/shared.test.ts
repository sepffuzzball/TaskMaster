import * as shared from '../src/index.js';
import { z } from 'zod';
import { describe, it, expect } from 'vitest';

describe('shared package', () => {
  it('exports schemas', () => {
    expect(shared.uuid).toBeDefined();
    expect(shared.Project).toBeDefined();
    expect(shared.Lane).toBeDefined();
    expect(shared.Task).toBeDefined();
    expect(shared.ApiError).toBeDefined();
  });

  it('uuid rejects non-uuids', () => {
    expect(() => shared.uuid.parse('not-a-uuid')).toThrow();
  });

  it('AiBreakdownOutput validates max 12 cards', () => {
    const cards = Array.from({ length: 13 }, (_, i) => ({
      title: `Card ${i}`,
    }));
    expect(() => shared.AiBreakdownOutput.parse({ cards })).toThrow();
  });
});
