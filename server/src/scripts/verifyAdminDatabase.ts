import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config } from '../config/env.js';
import { assertSISLMSProject } from './projectGuard.js';

// Generates only a temporary SQL artifact. Every synthetic record is rolled back.
assertSISLMSProject();
const expectedRef = 'pbkvjzclnwpucrhufyvr';
if (new URL(config.supabase.url).hostname !== `${expectedRef}.supabase.co`) throw new Error('Unexpected SIS project.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
if (readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim() !== expectedRef) throw new Error('Unexpected CLI link.');
const args = process.argv.slice(2);
if (args.length && (args[0] !== '--preview-migration' || args.length < 2)) {
  throw new Error('Usage: test:admin-db [--preview-migration <pending-filename.sql> ...]');
}
const migrations = args.slice(1).map(name => {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) throw new Error('Expected a migration filename, not a path.');
  const source = readFileSync(join(root, 'supabase/migrations', name), 'utf8');
  if (!/^BEGIN;[ \t]*\r?$/m.test(source) || !/COMMIT;\s*$/.test(source)) {
    throw new Error('Preview requires a transaction-wrapped migration.');
  }
  return source.replace(/^BEGIN;[ \t]*\r?$/m, '').replace(/COMMIT;\s*$/, '');
}).join('\n');
const assertions = readFileSync(join(root, 'server/test/admin-database.sql'), 'utf8');
const directory = mkdtempSync(join(tmpdir(), 'sis-admin-verification-'));
const file = join(directory, 'verify.sql');
try {
  writeFileSync(file, `BEGIN;\n${migrations}\nSET LOCAL plpgsql.check_asserts = on;\n${assertions}\nROLLBACK;`, 'utf8');
  const cliArgs = ['--yes', 'supabase', 'db', 'query', '--linked', '--file', file, '--output', 'json'];
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npx.cmd --yes supabase db query --linked --file "${file}" --output json`],
      { cwd: root, stdio: 'inherit', windowsVerbatimArguments: true })
    : spawnSync('npx', cliArgs, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  unlinkSync(file);
  rmdirSync(directory);
}
