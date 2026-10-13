// Copies the pinned liquid-gl browser bundle into public/ so the EJS frontend
// can import it as a same-origin ES module (no bundler, no CDN).
// Source of truth: node_modules/liquid-gl (pinned exact in package.json).
// Fails loudly on version/size mismatch so upgrades never ship silently stale.
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const EXPECTED_VERSION = '3.0.0'; // keep in sync with package.json

const src = resolve(root, 'node_modules', 'liquid-gl', 'liquidGL.js');
const dest = resolve(root, 'public', 'js', 'vendor', 'liquidGL.js');

let pkgVersion;
try {
  pkgVersion = JSON.parse(
    readFileSync(resolve(root, 'node_modules', 'liquid-gl', 'package.json'), 'utf-8'),
  ).version;
} catch {
  console.error('vendor-liquidgl: node_modules/liquid-gl not installed. Run npm install first.');
  process.exit(1);
}
if (pkgVersion !== EXPECTED_VERSION) {
  console.error(`vendor-liquidgl: expected liquid-gl@${EXPECTED_VERSION}, found ${pkgVersion}. Update EXPECTED_VERSION.`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);

const srcBuf = readFileSync(src);
const destBuf = readFileSync(dest);
if (!srcBuf.equals(destBuf)) {
  console.error('vendor-liquidgl: byte mismatch after copy. Aborting.');
  process.exit(1);
}
const sha = createHash('sha256').update(destBuf).digest('hex').slice(0, 16);
console.log(`vendor-liquidgl: liquid-gl@${pkgVersion} → public/js/vendor/liquidGL.js (${statSync(dest).size} bytes, sha256:${sha}…), byte-identical`);
