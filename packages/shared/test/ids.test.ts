import { expect, test } from 'bun:test';
import { add, normalise } from '../src';
import { deterministicUuid } from '../src/node';

test('deterministic UUIDs are stable and well-formed', () => {
  const id = deterministicUuid('event', 'a', 'b');
  expect(id).toBe(deterministicUuid('event', 'a', 'b'));
  expect(id).not.toBe(deterministicUuid('event', 'a', 'c'));
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('decimal arithmetic is exact', () => {
  expect(add('0.1', '0.2')).toBe('0.3');
  expect(normalise('-0.00')).toBe('0');
});
