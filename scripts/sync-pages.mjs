import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const docsDir = path.join(root, 'docs');
const rootAssetsDir = path.join(root, 'assets');

if (!fs.existsSync(distDir)) {
  console.error('dist directory does not exist. Run vite build first.');
  process.exit(1);
}

// Ensure assets/ and docs/ exist
fs.mkdirSync(rootAssetsDir, { recursive: true });
fs.mkdirSync(path.join(docsDir, 'assets'), { recursive: true });

// Copy compiled JS & CSS and official brand logos into root/assets and docs/assets
const distAssetsDir = path.join(distDir, 'assets');
if (fs.existsSync(distAssetsDir)) {
  for (const file of fs.readdirSync(distAssetsDir)) {
    const srcFile = path.join(distAssetsDir, file);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, path.join(rootAssetsDir, file));
      fs.copyFileSync(srcFile, path.join(docsDir, 'assets', file));
    }
  }
}

// Copy built index.html to root and docs/
const distIndex = path.join(distDir, 'index.html');
if (fs.existsSync(distIndex)) {
  const html = fs.readFileSync(distIndex, 'utf8');
  fs.writeFileSync(path.join(root, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(docsDir, 'index.html'), html, 'utf8');
}

// Ensure .nojekyll exists in root, dist, and docs
const notFound = path.join(root, '404.html');
if (fs.existsSync(notFound)) {
  fs.copyFileSync(notFound, path.join(distDir, '404.html'));
  fs.copyFileSync(notFound, path.join(docsDir, '404.html'));
}

for (const dir of [root, distDir, docsDir]) {
  fs.writeFileSync(path.join(dir, '.nojekyll'), '', 'utf8');
}

console.log('Synced static GitHub Pages bundle to root (/), /docs, and /dist.');
