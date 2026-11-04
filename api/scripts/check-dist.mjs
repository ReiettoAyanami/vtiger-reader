// The last step of `npm run dist`: is the packaged app really there, and does it start?
// On this PC electron-builder sometimes cannot rename its folder at once (EPERM, retried): once
// (2026-11-04) the result kept electron.exe instead of "vtiger reader.exe", and the build still
// said done. This catches it: the app's .exe must exist and pass the smoke test (src/desktop/main.ts).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const unpacked = fileURLToPath(new URL('../release/win-unpacked/', import.meta.url));
const exe = join(unpacked, 'vtiger reader.exe');

if (!existsSync(exe)) {
  console.error(`check-dist: ${exe} is missing: the package is broken, run npm run dist again`);
  process.exit(1);
}

const data = await mkdtemp(join(tmpdir(), 'vtiger-reader-check-'));
try {
  const run = spawnSync(exe, ['--smoke'], {
    cwd: unpacked,
    env: { ...process.env, VTIGER_READER_DATA: data },
    encoding: 'utf8',
    timeout: 90_000,
  });
  const line = `${run.stdout ?? ''}`.split('\n').find((l) => l.startsWith('SMOKE'));
  if (run.status !== 0 || !line?.startsWith('SMOKE OK')) {
    console.error(`check-dist: the packaged app failed its smoke test (exit ${run.status}): ${line ?? run.stderr?.slice(-500)}`);
    process.exit(1);
  }
  console.log(`check-dist: ${line.slice(0, 120)}`);
} finally {
  await rm(data, { recursive: true, force: true }).catch(() => undefined);
}
