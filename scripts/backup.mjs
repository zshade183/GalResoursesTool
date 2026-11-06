import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const source = resolve(process.argv[2] ?? 'data/studio.sqlite');
const directory = resolve('data/backups');
await mkdir(directory, { recursive: true });
const target = join(directory, `studio-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec('PRAGMA busy_timeout=5000');
  db.prepare('VACUUM INTO ?').run(target);
  const copy = new DatabaseSync(target, { readOnly: true });
  try { const result = copy.prepare('PRAGMA integrity_check').get(); if (result.integrity_check !== 'ok') throw new Error('Backup integrity check failed'); }
  finally { copy.close(); }
  console.log(`Verified backup: ${target}`);
} finally { db.close(); }
