import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));

let buildId;
try {
  const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  buildId = `${hash}-${ts}`;
} catch {
  buildId = 'dev';
}

// --- version.json ------------------------------------------------------------
const versionJson = {
  version: pkg.version,
  buildId,
  buildTimestamp: new Date().toISOString(),
};

writeFileSync(
  resolve(root, 'public', 'version.json'),
  JSON.stringify(versionJson, null, 2) + '\n',
);

console.log(`Generated public/version.json — version=${pkg.version} buildId=${buildId}`);

// --- sw.js (from template) ---------------------------------------------------
const swTemplate = readFileSync(resolve(root, 'public', 'sw.template.js'), 'utf-8');
const swContent = swTemplate.replace(/__BUILD_ID__/g, buildId);

writeFileSync(resolve(root, 'public', 'sw.js'), swContent);

console.log(`Generated public/sw.js — buildId=${buildId}`);
