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

  it('Lane schema requires autoCollapse boolean', () => {
    const validLane = {
      id: '12345678-1234-1234-1234-123456789abc',
      projectId: '22345678-2234-2234-2234-223456789abc',
      name: 'Test Lane',
      rank: 0,
      autoCollapse: true,
      version: 0,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    expect(() => shared.Lane.parse(validLane)).not.toThrow();
    // Missing autoCollapse should fail
    const { autoCollapse, ...withoutAutoCollapse } = validLane;
    expect(() => shared.Lane.parse(withoutAutoCollapse)).toThrow();
  });

  it('CreateLaneInput accepts optional autoCollapse', () => {
    const inputWithout = shared.CreateLaneInput.parse({ name: 'New Lane', expectedProjectVersion: 0 });
    expect(inputWithout.autoCollapse).toBeUndefined();
    const inputWith = shared.CreateLaneInput.parse({ name: 'New Lane', autoCollapse: false, expectedProjectVersion: 0 });
    expect(inputWith.autoCollapse).toBe(false);
  });

  it('UpdateLaneInput accepts optional autoCollapse and rejects empty', () => {
    // Empty (no name, no rank, no autoCollapse) should fail
    expect(() => shared.UpdateLaneInput.parse({ expectedVersion: 0, expectedProjectVersion: 0 })).toThrow();
    // With autoCollapse only should succeed
    const inputWith = shared.UpdateLaneInput.parse({ autoCollapse: true, expectedVersion: 0, expectedProjectVersion: 0 });
    expect(inputWith.autoCollapse).toBe(true);
    // With name only should succeed
    const inputName = shared.UpdateLaneInput.parse({ name: 'Test', expectedVersion: 0, expectedProjectVersion: 0 });
    expect(inputName.name).toBe('Test');
  });
});
