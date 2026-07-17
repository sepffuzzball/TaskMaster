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
    expect(shared.Tag).toBeDefined();
    expect(shared.UpdateTagInput).toBeDefined();
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

  it('Tag schema validates name pattern', () => {
    const validTag = { id: '12345678-1234-1234-1234-123456789abc', name: 'valid-name_123', color: '#F56565', version: 0, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' };
    expect(() => shared.Tag.parse({ ...validTag, name: 'invalid name with spaces' })).toThrow();
    expect(() => shared.Tag.parse(validTag)).not.toThrow();
  });

  it('Tag schema validates color pattern', () => {
    const validTag = { id: '12345678-1234-1234-1234-123456789abc', name: 'valid-name', color: '#F56565', version: 0, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' };
    expect(() => shared.Tag.parse({ ...validTag, color: 'invalid' })).toThrow();
    expect(() => shared.Tag.parse(validTag)).not.toThrow();
  });

  it('UpdateTagInput schema parses correctly', () => {
    const input = shared.UpdateTagInput.parse({ name: 'new-name', color: '#3182CE', expectedVersion: 0 });
    expect(input.name).toBe('new-name');
    expect(input.color).toBe('#3182CE');
  });
});
