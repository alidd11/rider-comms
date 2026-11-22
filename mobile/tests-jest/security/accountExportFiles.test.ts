import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  createTemporaryAccountExport,
  pruneExpiredAccountExports,
} from '../../src/security/accountExportFiles';
import { ACCOUNT_EXPORT_MAX_CACHE_AGE_MS } from '../../src/security/accountExportRetention';

const mockFiles = {
  directoryExists: false,
  entries: [] as unknown[],
  deleted: [] as string[],
  createCalls: 0,
  failWrite: false,
  failDelete: false,
};

jest.mock('expo-file-system', () => {
  class FakeDirectory {
    constructor(..._path: unknown[]) {}
    get exists() { return mockFiles.directoryExists; }
    create(_options?: unknown) {
      mockFiles.directoryExists = true;
      mockFiles.createCalls += 1;
    }
    list() { return mockFiles.entries; }
  }
  class FakeFile {
    name: string;
    exists = false;
    data = '';
    constructor(_parent: unknown, name: string) { this.name = name; }
    create() {
      this.exists = true;
      mockFiles.entries.push(this);
    }
    async write(data: string) {
      if (mockFiles.failWrite) throw new Error('mock file write failed');
      this.data = data;
    }
    delete() {
      if (mockFiles.failDelete) throw new Error('mock file busy');
      mockFiles.deleted.push(this.name);
      this.exists = false;
      mockFiles.entries = mockFiles.entries.filter((entry) => entry !== this);
    }
  }
  return {
    Paths: { cache: '/private/app/cache' },
    Directory: FakeDirectory,
    File: FakeFile,
  };
});

const NOW = 1_800_000_000_000;
type MockExportFile = {
  name: string;
  exists: boolean;
  data: string;
  create(): void;
  delete(): void;
};

function fakeExistingFile(name: string): MockExportFile {
  const { File } = jest.requireMock('expo-file-system') as {
    File: new (directory: string, name: string) => MockExportFile;
  };
  const f = new File('/private/app/cache/rider-comms-private-account-exports', name);
  f.create();
  return f;
}

beforeEach(() => {
  mockFiles.directoryExists = false;
  mockFiles.entries = [];
  mockFiles.deleted = [];
  mockFiles.createCalls = 0;
  mockFiles.failWrite = false;
  mockFiles.failDelete = false;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => { jest.restoreAllMocks(); });

describe('native private account data export file handling', () => {
  test('creates JSON only inside its dedicated cache and keeps it for system preview', async () => {
    const privateText = '<sensitive account & message>';
    const file = await createTemporaryAccountExport({ messages: [{ text: privateText }] });
    expect(mockFiles.directoryExists).toBe(true);
    expect(mockFiles.createCalls).toBe(1);
    expect(file.name).toMatch(/^rider-comms-data-1800000000000-[a-z0-9]{8}\.json$/);
    expect(JSON.parse((file as MockExportFile).data)).toEqual({ messages: [{ text: privateText }] });
    expect(mockFiles.deleted).toEqual([]);
    pruneExpiredAccountExports(NOW + ACCOUNT_EXPORT_MAX_CACHE_AGE_MS - 1);
    expect(mockFiles.deleted).toEqual([]);
    pruneExpiredAccountExports(NOW + ACCOUNT_EXPORT_MAX_CACHE_AGE_MS);
    expect(mockFiles.deleted).toEqual([file.name]);
    expect((file as MockExportFile).exists).toBe(false);
  });

  test('prunes only expired exported JSON and never deletes unrelated cache files', () => {
    pruneExpiredAccountExports(NOW);
    expect(mockFiles.deleted).toEqual([]);
    const old = fakeExistingFile('rider-comms-data-' +
      (NOW - ACCOUNT_EXPORT_MAX_CACHE_AGE_MS - 5) + '-abc12345.json');
    const future = fakeExistingFile('rider-comms-data-' + (NOW + 1000) + '-abc12345.json');
    const unrelated = fakeExistingFile('unrelated-cache-file.json');
    mockFiles.entries.push({ name: old.name, delete: () => { throw new Error('not a File'); } });
    pruneExpiredAccountExports(NOW);
    expect(mockFiles.deleted).toEqual([old.name]);
    expect(future.exists).toBe(true);
    expect(unrelated.exists).toBe(true);
  });

  test('tolerates locked files and retries eviction on the next cleanup', () => {
    const old = fakeExistingFile('rider-comms-data-' +
      (NOW - ACCOUNT_EXPORT_MAX_CACHE_AGE_MS) + '-abc12345.json');
    mockFiles.failDelete = true;
    expect(() => pruneExpiredAccountExports(NOW)).not.toThrow();
    expect(old.exists).toBe(true);
    mockFiles.failDelete = false;
    pruneExpiredAccountExports(NOW);
    expect(old.exists).toBe(false);
  });

  test('deletes a partial temporary export if writing sensitive JSON fails', async () => {
    mockFiles.failWrite = true;
    await expect(createTemporaryAccountExport({ secret: 'never leave partial data' }))
      .rejects.toThrow('mock file write failed');
    expect(mockFiles.deleted).toHaveLength(1);
    expect(mockFiles.entries).toHaveLength(0);
  });
});
