import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {inspectFlootExport} from '../scripts/inspect-floot-export.mjs';

const expected = 'app.floot.u7f273ff531794961b47bf464cf562250';
function setup(t, {nativeId = expected, web = true} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'dexter-export-inspect-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const write=(name,content)=>{
    const location=path.join(dir,name);
    fs.mkdirSync(path.dirname(location),{recursive:true});
    fs.writeFileSync(location,typeof content==='string'?content:JSON.stringify(content));
  };
  write('package.json',{name:'floot-real-dexter',private:true});
  write('capacitor.config.json',{appId:expected,webDir:'www'});
  write('ios/App/App/capacitor.config.json',{appId:nativeId,packageClassList:['AppPlugin']});
  write('ios/App/Podfile',"platform :ios, '15.5'\ntarget 'App' do\nend\n");
  write('ios/App/App.xcodeproj/project.pbxproj','PRODUCT_BUNDLE_IDENTIFIER = '+expected+';');
  write('ios/App/App/Info.plist','<plist><dict><key>NSPhotoLibraryUsageDescription</key><string>Access photos</string></dict></plist>');
  write('ios/App/App/public/index.html','<!doctype html><html><body><script src="bundle.js"></script></body></html>');
  write('ios/App/App/public/bundle.js', web ?
    'const name="DexterPhotoKit";const fn="getAssetsPage";throw Error("Selecionaste mais de 10 fotografias");' :
    'console.log("outdated build")');
  return {dir,write};
}
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

test('accepts only as a REVIEW REQUIRED preflight; no signing or device claims', t=>{
  const {dir}=setup(t);
  const watched=path.join(dir,'ios/App/App/public/bundle.js');
  const before=sha(fs.readFileSync(watched));
  const result=inspectFlootExport(dir);
  assert.equal(result.status,'REVIEW_REQUIRED');
  assert.deepEqual(result.problems,[]);
  assert.equal(result.rootAppId,expected);
  assert.equal(result.nativeAppId,expected);
  assert.equal(result.safeToShip,false);
  assert.equal(result.deviceTested,false);
  assert.equal(sha(fs.readFileSync(watched)),before,'inspector must not alter app web payload');
});
test('refuses to touch another bundle id',t=>{
  const {dir}=setup(t,{nativeId:'com.other.app'});
  const result=inspectFlootExport(dir);
  assert.equal(result.status,'BLOCKED');
  assert.match(result.problems.join(' '),/bundle identity mismatch/);
});
test('refuses stale compiled web bundle even with correct native app id',t=>{
  const {dir}=setup(t,{web:false});
  const result=inspectFlootExport(dir);
  assert.equal(result.status,'BLOCKED');
  assert.deepEqual(result.webMarkers,{plugin:false,pagination:false,selectionGuard:false});
});
test('refuses incomplete or unrecognized original project archive',t=>{
  const {dir}=setup(t);
  fs.rmSync(path.join(dir,'ios/App/App/Info.plist'));
  const result=inspectFlootExport(dir);
  assert.equal(result.status,'BLOCKED');
  assert.match(result.problems.join(' '),/Info\.plist|NSPhotoLibraryUsageDescription/);
});
test('does not disclose contents of signing files',t=>{
  const {dir,write}=setup(t);
  write('ios/App/release.p8','VERY_PRIVATE_SIGNING_CONTENT');
  const result=inspectFlootExport(dir);
  assert.equal(result.sensitiveFilesPresent,true);
  assert.equal(JSON.stringify(result).includes('VERY_PRIVATE_SIGNING_CONTENT'),false);
  assert.equal(result.status,'REVIEW_REQUIRED');
});
test('rejects symlinks in web directory',t=>{
  const {dir}=setup(t);
  fs.symlinkSync('/etc/hosts',path.join(dir,'ios/App/App/public/linked.js'));
  const result=inspectFlootExport(dir);
  assert.equal(result.status,'BLOCKED');
  assert.match(result.problems.join(' '),/symlinks/);
});


test('blocks a different Xcode bundle identifier even if both Capacitor IDs match', t => {
  const {dir,write} = setup(t);
  write('ios/App/App.xcodeproj/project.pbxproj',
    'PRODUCT_BUNDLE_IDENTIFIER = com.unrelated.photos;');
  const result = inspectFlootExport(dir);
  assert.equal(result.rootAppId, expected);
  assert.equal(result.nativeAppId, expected);
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.problems.join(' '), /Xcode PRODUCT_BUNDLE_IDENTIFIER/);
});

test('blocks Xcode builds with mixed identities or without an explicit app identity', t => {
  const {dir,write} = setup(t);
  write('ios/App/App.xcodeproj/project.pbxproj',
    'PRODUCT_BUNDLE_IDENTIFIER = '+expected+';\nPRODUCT_BUNDLE_IDENTIFIER = other.app;');
  assert.equal(inspectFlootExport(dir).status, 'BLOCKED');
  write('ios/App/App.xcodeproj/project.pbxproj', 'SWIFT_VERSION = 5.0;');
  assert.equal(inspectFlootExport(dir).status, 'BLOCKED');
});

test('blocks Photos permission keys that exist only in XML comments or CDATA', t => {
  const {dir, write} = setup(t);
  write('ios/App/App/Info.plist',
    '<plist><dict><!-- <key>NSPhotoLibraryUsageDescription</key><string>Access</string> --></dict></plist>');
  let result = inspectFlootExport(dir);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.hasPhotoPermission, false);
  write('ios/App/App/Info.plist',
    '<plist><dict><key>Example</key><string><![CDATA[<key>NSPhotoLibraryUsageDescription</key><string>Fake</string>]]></string></dict></plist>');
  result = inspectFlootExport(dir);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.hasPhotoPermission, false);
});

test('blocks ambiguous duplicate Photos permission keys and unterminated XML comments', t => {
  const {dir, write} = setup(t);
  const key = '<key>NSPhotoLibraryUsageDescription</key><string>Access photos</string>';
  write('ios/App/App/Info.plist', '<plist><dict>'+key+key+'</dict></plist>');
  assert.equal(inspectFlootExport(dir).status, 'BLOCKED');
  write('ios/App/App/Info.plist', '<plist><dict>'+key+'<!-- unterminated</dict></plist>');
  assert.equal(inspectFlootExport(dir).status, 'BLOCKED');
});

test('allows an active explanation even if an obsolete version was commented out', t => {
  const {dir, write} = setup(t);
  write('ios/App/App/Info.plist',
    '<plist><dict><!-- <key>NSPhotoLibraryUsageDescription</key><string>Old</string> --><key>NSPhotoLibraryUsageDescription</key><string>Acesso às fotografias</string></dict></plist>');
  const result = inspectFlootExport(dir);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.hasPhotoPermission, true);
});

test('rejects an empty Photos permission explanation', t => {
  const {dir,write} = setup(t);
  write('ios/App/App/Info.plist',
    '<plist><dict><key>NSPhotoLibraryUsageDescription</key><string>   </string></dict></plist>');
  const result = inspectFlootExport(dir);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.hasPhotoPermission, false);
});

test('does not follow an iOS ancestor symlink even when the file itself is regular', t => {
  const {dir} = setup(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(),'dexter-foreign-native-'));
  t.after(() => fs.rmSync(outside,{force:true,recursive:true}));
  const nativePath=path.join(dir,'ios/App');
  fs.renameSync(nativePath,path.join(outside,'App'));
  fs.symlinkSync(path.join(outside,'App'),nativePath,'dir');
  const result=inspectFlootExport(dir);
  assert.equal(result.status,'BLOCKED');
  assert.match(result.problems.join(' '),/Symlink|non-regular|Cannot inspect/);
  assert.equal(result.safeToShip,false);
});

test('does not scan the packaged web bundle through a directory symlink', t => {
  const {dir}=setup(t);
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'dexter-foreign-web-'));
  t.after(() => fs.rmSync(outside,{force:true,recursive:true}));
  const publicPath=path.join(dir,'ios/App/App/public');
  fs.renameSync(publicPath,path.join(outside,'public'));
  fs.symlinkSync(path.join(outside,'public'),publicPath,'dir');
  const result=inspectFlootExport(dir);
  assert.equal(result.status,'BLOCKED');
  assert.match(result.problems.join(' '),/Symlink/);
  assert.equal(result.webFileCount,0);
});
