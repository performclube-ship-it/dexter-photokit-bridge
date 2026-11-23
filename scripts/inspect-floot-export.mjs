#!/usr/bin/env node
/**
 * DEXTER export preflight. READ-ONLY by design.
 *
 * Inspects an EXTRACTED original Floot native iOS Project zip. Does not touch
 * CocoaPods, sign an app, execute cap sync/copy, or write to the export.
 *
 * A passing result means ONLY "safe to inspect and prepare a native patch".
 * It is not approval to publish, sign, or modify Apple Photos.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const EXPECTED_APP_ID = 'app.floot.u7f273ff531794961b47bf464cf562250';
const REQUIRED_FILES = [
  'package.json',
  'capacitor.config.json',
  'ios/App/Podfile',
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/Info.plist',
  'ios/App/App/capacitor.config.json',
  'ios/App/App/public/index.html'
];
const SENSITIVE_NAME = /(^|\/)(\.env(\..*)?|[^/]+\.(p8|p12|mobileprovision|keystore|jks))$/i;

// Reject commented-out, CDATA-only or ambiguous privacy keys. Conservative
// read-only preflight: not a replacement for parsing the real plist in Xcode.
function hasActivePhotosUsageKey(plist) {
  if (!/<plist(?:\s|>)/.test(plist) || !/<dict>/.test(plist)) return false;
  const noComments = plist.replace(/<!--[\s\S]*?-->/g, '');
  if (noComments.includes('<!--') || noComments.includes('-->')) return false;
  const active = noComments.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (active.includes('<![CDATA[')) return false;
  const values = [...active.matchAll(
    /<key>\s*NSPhotoLibraryUsageDescription\s*<\/key>\s*<string>([^<]*)<\/string>/g
  )];
  return values.length === 1 && /\S/.test(values[0][1]);
}

// Every ancestor is checked with lstat before reading any bytes. Checking only
// the final file lets an untrusted export follow an ios/App or public symlink.
function safePath(root, relative, type = 'file') {
  const base = path.resolve(root);
  const rootStat = fs.lstatSync(base);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    'Export root must be a real directory');
  const segments = relative.split('/');
  assert.ok(segments.length && segments.every(s => s && s !== '.' && s !== '..'),
    'Unsafe export-relative path');
  let target = base;
  for (let i = 0; i < segments.length; i++) {
    target = path.join(target, segments[i]);
    const stat = fs.lstatSync(target);
    assert.ok(!stat.isSymbolicLink(), 'Symlink is not accepted in export: ' + relative);
    if (i < segments.length - 1 || type === 'directory')
      assert.ok(stat.isDirectory(), 'Expected a directory in export: ' + relative);
    else
      assert.ok(stat.isFile(), 'Expected a regular file in export: ' + relative);
  }
  return target;
}
function fileText(root, relative) {
  return fs.readFileSync(safePath(root, relative), 'utf8');
}

function collectWebFiles(root, maxFiles = 2000, maxBytes = 40 * 1024 * 1024) {
  const base = safePath(root, 'ios/App/App/public', 'directory');
  const files = [];
  let bytes = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      const absolute = path.join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Web asset symlinks are not accepted');
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        files.push(absolute);
        assert.ok(files.length <= maxFiles, 'Unexpectedly large web file count');
        const size = fs.statSync(absolute).size;
        bytes += size;
        assert.ok(bytes <= maxBytes, 'Unexpectedly large packaged web payload');
      }
    }
  }
  walk(base);
  return files;
}

function digest(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

export function inspectFlootExport(root) {
  const exportRoot = path.resolve(root);
  const problems = [];
  const warnings = [];
  let rootConfig;
  let nativeConfig;
  const criticalDigests = {};
  for (const relative of REQUIRED_FILES) {
    try {
      criticalDigests[relative] = digest(fs.readFileSync(safePath(exportRoot, relative)));
    } catch {
      problems.push('Missing or non-regular required file: ' + relative);
    }
  }
  let packageName = null;
  try { packageName = JSON.parse(fileText(exportRoot, 'package.json')).name || null; }
  catch { problems.push('Cannot parse package.json'); }
  try { rootConfig = JSON.parse(fileText(exportRoot, 'capacitor.config.json')); }
  catch { problems.push('Cannot parse root Capacitor configuration'); }
  try { nativeConfig = JSON.parse(fileText(exportRoot, 'ios/App/App/capacitor.config.json')); }
  catch { problems.push('Cannot parse packaged native Capacitor configuration'); }

  const rootId = rootConfig?.appId || null;
  const nativeId = nativeConfig?.appId || null;
  if (rootId !== EXPECTED_APP_ID || nativeId !== EXPECTED_APP_ID)
    problems.push('DEXTER bundle identity mismatch; stop rather than modifying another iOS app');
  if (rootConfig && !rootConfig.webDir)
    warnings.push('Root capacitor.config.json has no webDir; inspect build layout manually');

  // Capacitor's JSON IDs are not authoritative for what iOS signs: the Xcode
  // build settings can still target a DIFFERENT installed application.
  let xcodeBundleIds = [];
  try {
    const project = fileText(exportRoot, 'ios/App/App.xcodeproj/project.pbxproj');
    xcodeBundleIds = [...project.matchAll(/\bPRODUCT_BUNDLE_IDENTIFIER\s*=\s*(?:"([^"]+)"|([^;\s]+))\s*;/g)]
      .map(match => match[1] || match[2]);
    if (!xcodeBundleIds.length || xcodeBundleIds.some(id => id !== EXPECTED_APP_ID)) {
      problems.push('Xcode PRODUCT_BUNDLE_IDENTIFIER is missing or differs from the DEXTER app; stop');
    }
  } catch {
    problems.push('Cannot inspect Xcode bundle identity');
  }

  let platform = null;
  try {
    const podfile = fileText(exportRoot, 'ios/App/Podfile');
    platform = podfile.match(/platform\s+:ios,\s*['"]([^'"]+)['"]/)?.[1] || null;
    if (!platform) problems.push('Cannot establish iOS CocoaPods deployment target');
    else if (Number(platform) < 15.5)
      warnings.push('iOS deployment target below the bridge minimum 15.5; review before adjusting');
    if (!podfile.includes("target 'App' do")) problems.push('Unknown CocoaPods App target');
  } catch {
    problems.push('Cannot inspect CocoaPods Podfile');
  }

  let hasPhotoPermission = false;
  try {
    const plist = fileText(exportRoot, 'ios/App/App/Info.plist');
    hasPhotoPermission = hasActivePhotosUsageKey(plist);
    if (!hasPhotoPermission)
      problems.push('Missing readable NSPhotoLibraryUsageDescription; inspect plist before compiling');
  } catch {
    problems.push('Could not inspect iOS Info.plist as text; inspect binary plist manually');
  }

  let webFileCount = 0, webSha256 = null;
  const webMarkers = { plugin: false, pagination: false, selectionGuard: false };
  try {
    const files = collectWebFiles(exportRoot);
    webFileCount = files.length;
    const fingerprint = crypto.createHash('sha256');
    for (const name of files.sort()) {
      const rel = path.relative(exportRoot, name).replaceAll(path.sep, '/');
      const content = fs.readFileSync(name);
      fingerprint.update(rel).update('\0').update(digest(content)).update('\n');
      if (!/\.(js|html)$/i.test(name)) continue;
      const text = content.toString('utf8');
      if (text.includes('DexterPhotoKit')) webMarkers.plugin = true;
      if (text.includes('getAssetsPage')) webMarkers.pagination = true;
      if (text.includes('Selecionaste') && text.includes('fotografias'))
        webMarkers.selectionGuard = true;
    }
    webSha256 = fingerprint.digest('hex');
    if (!webMarkers.plugin || !webMarkers.pagination || !webMarkers.selectionGuard)
      problems.push('Stale or unverified embedded web bundle: native bridge/selection guards absent');
  } catch (error) {
    problems.push('Cannot inspect packaged web payload: ' + (error instanceof Error ? error.message : 'unknown'));
  }

  let sensitiveFilesPresent = false;
  // A file export may legitimately contain signing material: never send it
  // to the public plugin repository or log its contents.
  const probe = [exportRoot, path.join(exportRoot, 'ios'), path.join(exportRoot, 'ios/App')];
  for (const dir of probe) {
    if (!fs.existsSync(dir)) continue;
    for (const item of fs.readdirSync(dir)) {
      if (SENSITIVE_NAME.test(path.relative(exportRoot, path.join(dir, item)).replaceAll(path.sep,'/')))
        sensitiveFilesPresent = true;
    }
  }
  if (sensitiveFilesPresent)
    warnings.push('Potential signing/secret files detected: keep whole export private; do not publish it in GitHub');

  return {
    schemaVersion: 1, inspector: 'read-only-floot-export', expectedAppId: EXPECTED_APP_ID,
    rootAppId: rootId, nativeAppId: nativeId, xcodeBundleIds, packageName, iosPlatform: platform,
    hasPhotoPermission, webFileCount, webSha256, webMarkers,
    criticalDigests, sensitiveFilesPresent,
    status: problems.length ? 'BLOCKED' : 'REVIEW_REQUIRED',
    problems, warnings,
    signed: false, deviceTested: false, safeToShip: false
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/inspect-floot-export.mjs <extracted-floot-native-project-directory>');
    process.exitCode = 2;
  } else {
    const result = inspectFlootExport(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'REVIEW_REQUIRED') process.exitCode = 2;
  }
}
