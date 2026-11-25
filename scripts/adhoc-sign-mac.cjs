const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(cmd, args) {
  console.log(`[adhoc-sign-mac] Running: ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  if (process.platform !== 'darwin') {
    console.log('[adhoc-sign-mac] Skipping macOS ad-hoc signing on non-macOS host.');
    return;
  }

  // If a real Apple Developer ID certificate is supplied, let electron-builder handle signing & notarization.
  if (process.env.CSC_LINK && process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false') {
    console.log('[adhoc-sign-mac] CSC_LINK detected; deferring to electron-builder Developer ID signing.');
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  if (!fs.existsSync(appPath)) {
    throw new Error(`[adhoc-sign-mac] Expected app bundle not found at: ${appPath}`);
  }

  console.log(`[adhoc-sign-mac] Ad-hoc signing macOS bundle: ${appPath}`);

  // Strip extended attributes / resource forks that can break codesign sealing.
  run('/usr/bin/xattr', ['-cr', appPath]);

  // Ad-hoc sign the entire app bundle deeply so Info.plist is bound, resources are sealed,
  // and every nested framework, dylib, and helper app has a valid signature for Apple Silicon (M1-M5).
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath]);

  // Strictly verify the bundle signature before packaging into DMG/ZIP.
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

  // Inspect signature metadata (codesign -dvv writes to stderr).
  const info = spawnSync('/usr/bin/codesign', ['-dvv', appPath], { encoding: 'utf8' });
  const report = `${info.stdout || ''}\n${info.stderr || ''}`.trim();
  console.log(`[adhoc-sign-mac] Signature details:\n${report}`);

  if (info.status !== 0) {
    throw new Error(`[adhoc-sign-mac] codesign -dvv failed with status ${info.status}`);
  }
  if (report.includes('linker-signed')) {
    throw new Error('[adhoc-sign-mac] App still carries a linker-signed signature.');
  }
  if (report.includes('Info.plist=not bound')) {
    throw new Error('[adhoc-sign-mac] Info.plist is not bound in the code signature.');
  }
  if (report.includes('Sealed Resources=none')) {
    throw new Error('[adhoc-sign-mac] Sealed Resources are missing from the code signature.');
  }

  console.log(`[adhoc-sign-mac] Verified valid ad-hoc signature for: ${appPath}`);
}

module.exports = afterPack;
module.exports.default = afterPack;
