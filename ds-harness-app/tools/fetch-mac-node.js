const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const url = 'https://nodejs.org/dist/v22.22.0/node-v22.22.0-darwin-arm64.tar.gz';
const tmpDir = os.tmpdir();
const out = path.join(tmpDir, 'nd-mac.tar.gz');
const extractDir = path.join(tmpDir, 'nd-mac');
const macBin = process.argv[2] || 'C:/Users/jiang/WorkBuddy/2026-08-23-10-12-45/ds-harness-app/dist_mac/ds-harness-app-darwin-arm64/ds-harness-app.app/Contents/Resources/app/bin/node';

function dl(u) {
  return new Promise((resolve, reject) => {
    https.get(u, { timeout: 60000 }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) { dl(res.headers.location).then(resolve).catch(reject); return; }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const w = fs.createWriteStream(out);
      res.pipe(w);
      w.on('finish', () => resolve(fs.statSync(out).size));
    }).on('error', reject);
  });
}

dl(url).then(size => {
  console.log('DL_OK', size, 'bytes');
  execSync('rm -rf "' + extractDir + '" && mkdir -p "' + extractDir + '"', { stdio: 'inherit' });
  execSync('tar xzf "' + out + '" -C "' + extractDir + '" --strip-components=1', { stdio: 'inherit' });
  fs.copyFileSync(path.join(extractDir, 'node'), macBin);
  fs.chmodSync(macBin, 0o755);
  console.log('NODE_BUNDLED_OK', fs.statSync(macBin).size);
}).catch(e => { console.error(e.message); process.exit(1); });
