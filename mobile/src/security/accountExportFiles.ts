import { Directory, File, Paths } from 'expo-file-system';
import { isExpiredAccountExportFile } from './accountExportRetention';

/** App-private cache location for exports being viewed by the OS.
 * Never store the JSON in AsyncStorage, SecureStore, logs, or a shared folder. */
const EXPORT_CACHE_SUBDIRECTORY = 'rider-comms-private-account-exports';

function accountExportDirectory(): Directory {
  return new Directory(Paths.cache, EXPORT_CACHE_SUBDIRECTORY);
}

/** Best-effort eviction: the OS preview handoff resolves before the viewer
 * closes, so deleting immediately after preview could truncate a download.
 * Older copies are deleted when the app starts or another export is made. */
export function pruneExpiredAccountExports(nowMs = Date.now()): void {
  const directory = accountExportDirectory();
  if (!directory.exists) return;
  for (const entry of directory.list()) {
    if (!(entry instanceof File) || !isExpiredAccountExportFile(entry.name, nowMs)) continue;
    try {
      entry.delete();
    } catch {
      // An external viewer might still have the file open. Retry next launch.
    }
  }
}

/** Create a private temporary file for the OS preview flow. Caller owns
 * cleanup if preview cannot be opened; the retention sweep owns old files. */
export async function createTemporaryAccountExport(data: unknown): Promise<File> {
  const directory = accountExportDirectory();
  directory.create({ idempotent: true });
  pruneExpiredAccountExports();
  const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  const file = new File(directory, 'rider-comms-data-' + Date.now() + '-' + suffix + '.json');
  try {
    file.create();
    await file.write(JSON.stringify(data, null, 2) + '\n');
    return file;
  } catch (error) {
    try { if (file.exists) file.delete(); } catch { /* original error wins */ }
    throw error;
  }
}
