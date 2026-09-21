import { appendFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const platforms = process.argv.slice(2);
if (platforms.length === 0) {
  throw new Error('Usage: node scripts/report-native-export-sizes.mjs <platform=directory> [...]');
}

const toMiB = (bytes) => bytes / (1024 * 1024);
const formatMiB = (bytes) => `${toMiB(bytes).toFixed(2)} MiB`;

async function walk(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(root, absolute));
    } else if (entry.isFile()) {
      const info = await stat(absolute);
      files.push({
        path: path.relative(root, absolute).replaceAll(path.sep, '/'),
        bytes: info.size,
      });
    }
  }
  return files;
}

const report = {
  generatedAt: new Date().toISOString(),
  note: 'Expo export payload only. This is not an IPA/AAB/App Store installed-size measurement.',
  platforms: {},
};

for (const pair of platforms) {
  const separator = pair.indexOf('=');
  if (separator <= 0) throw new Error(`Invalid platform argument: ${pair}`);
  const platform = pair.slice(0, separator);
  const directory = pair.slice(separator + 1);
  const files = await walk(directory);
  files.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  report.platforms[platform] = {
    directory,
    totalBytes,
    totalMiB: Number(toMiB(totalBytes).toFixed(3)),
    fileCount: files.length,
    largestFiles: files.slice(0, 10),
  };
}

await writeFile('native-export-size-report.json', `${JSON.stringify(report, null, 2)}\n`);

const rows = Object.entries(report.platforms)
  .map(([platform, data]) => `| ${platform} | ${formatMiB(data.totalBytes)} | ${data.fileCount} |`)
  .join('\n');

const markdown = [
  '## Native export size',
  '',
  '> Expo export payload only; this is not the final IPA/AAB or installed App Store/Play Store size.',
  '',
  '| Platform | Export payload | Files |',
  '| --- | ---: | ---: |',
  rows,
  '',
  '### Largest files',
  '',
  ...Object.entries(report.platforms).flatMap(([platform, data]) => [
    `**${platform}**`,
    '',
    ...data.largestFiles.map((file) => `- ${file.path}: ${formatMiB(file.bytes)}`),
    '',
  ]),
].join('\n');

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}
