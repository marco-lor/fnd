import {
  createCursorFromDocument,
  createPageCursor,
  getStartAfterValues,
  mergeUniquePage,
  parsePageCursor,
  resolveCompatibleOrdering,
} from './pagination';
import { Timestamp } from '../performance/firestore';

describe('versioned Firestore pagination contracts', () => {
  test('equal sort values remain unique because document ID is the final scalar', () => {
    const first = createPageCursor({
      queryKey: 'directory.users.page.v1',
      sortValues: ['alba'],
      documentId: 'user-a',
    });
    const second = createPageCursor({
      queryKey: 'directory.users.page.v1',
      sortValues: ['alba'],
      documentId: 'user-b',
    });

    expect(getStartAfterValues(first, {
      queryKey: 'directory.users.page.v1',
      sortValueCount: 1,
    })).toEqual(['alba', 'user-a']);
    expect(getStartAfterValues(second, {
      queryKey: 'directory.users.page.v1',
      sortValueCount: 1,
    })).toEqual(['alba', 'user-b']);
  });

  test('deleted cursor documents are represented only by serializable values', () => {
    const cursor = createCursorFromDocument({
      id: 'deleted-later',
      data: () => ({ normalizedLabel: 'marco' }),
    }, {
      queryKey: 'directory.users.page.v1',
      sortFields: ['normalizedLabel'],
    });
    const serialized = JSON.parse(JSON.stringify(cursor));

    expect(parsePageCursor(serialized, {
      queryKey: 'directory.users.page.v1',
      sortValueCount: 1,
    })).toEqual(cursor);
    expect(serialized).toEqual({
      version: 1,
      queryKey: 'directory.users.page.v1',
      sortValues: ['marco'],
      documentId: 'deleted-later',
    });
  });

  test('Firestore Timestamp sort values round-trip through JSON without changing query type', () => {
    const timestamp = new Timestamp(1_725_000_000, 123_456_789);
    const cursor = createCursorFromDocument({
      id: 'timestamped-document',
      data: () => ({ updatedAt: timestamp }),
    }, {
      queryKey: 'foes.updated.page.v1',
      sortFields: ['updatedAt'],
    });
    const serialized = JSON.parse(JSON.stringify(cursor));

    expect(serialized.sortValues).toEqual([{
      type: 'firestore-timestamp',
      seconds: 1_725_000_000,
      nanoseconds: 123_456_789,
    }]);
    const [decoded, documentId] = getStartAfterValues(serialized, {
      queryKey: 'foes.updated.page.v1',
      sortValueCount: 1,
    });
    expect(decoded).toBeInstanceOf(Timestamp);
    expect(decoded.seconds).toBe(timestamp.seconds);
    expect(decoded.nanoseconds).toBe(timestamp.nanoseconds);
    expect(documentId).toBe('timestamped-document');
  });

  test('duplicate or overlapping pages merge without duplicate IDs', () => {
    const preserved = { id: 'a', value: 1 };
    const replacement = { id: 'b', value: 3 };
    const merged = mergeUniquePage(
      [preserved, { id: 'b', value: 2 }],
      [replacement, { id: 'c', value: 4 }, replacement]
    );

    expect(merged.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(merged[0]).toBe(preserved);
    expect(merged[1]).toBe(replacement);
  });

  test('missing legacy sort fields keep the whole contract on document ID until 100%', () => {
    expect(resolveCompatibleOrdering({
      compatibilityQueryKey: 'foes.compatibility.v1',
      targetQueryKey: 'foes.updated.page.v2',
      targetSortFields: ['updatedAt'],
      backfillPercent: 99.999,
    })).toEqual({
      queryKey: 'foes.compatibility.v1',
      sortFields: [],
      compatibilityMode: true,
    });

    expect(resolveCompatibleOrdering({
      compatibilityQueryKey: 'foes.compatibility.v1',
      targetQueryKey: 'foes.updated.page.v2',
      targetSortFields: ['updatedAt'],
      backfillPercent: 100,
    })).toEqual({
      queryKey: 'foes.updated.page.v2',
      sortFields: ['updatedAt'],
      compatibilityMode: false,
    });
  });

  test('rejects a cursor from a different query contract', () => {
    const cursor = createPageCursor({
      queryKey: 'directory.users.page.v1',
      sortValues: ['a'],
      documentId: 'one',
    });
    expect(() => parsePageCursor(cursor, {
      queryKey: 'directory.users.by-role.page.v1',
      sortValueCount: 1,
    })).toThrow('queryKey does not match');
  });
});
