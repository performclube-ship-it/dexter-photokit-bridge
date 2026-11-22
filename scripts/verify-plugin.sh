#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node --check dist/index.js
ruby -c DexterPhotoKit.podspec
if command -v swiftc >/dev/null 2>&1; then
  swiftc -frontend -parse ios/Plugin/DexterPhotoKitPlugin.swift
  echo 'Swift syntactic parse OK (this is NOT Xcode framework compilation)'
else
  echo 'swiftc unavailable; native compilation requires macOS Xcode CI'
fi
npm test
npm pack --dry-run >/dev/null
