Pod::Spec.new do |s|
  s.name = 'DexterPhotoKit'
  s.version = '0.1.0'
  s.summary = 'Capacitor 8 PhotoKit metadata/album-association bridge for DEXTER'
  s.description = 'On-device metadata paging and explicit association of existing PHAssets into user albums, without copying or deleting originals.'
  s.homepage = 'https://github.com/performclube-ship-it/dexter-photokit-bridge'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = { 'DEXTER' => 'DEXTER' }
  s.source = { :git => 'https://github.com/performclube-ship-it/dexter-photokit-bridge.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m,c,mm,cpp}'
  s.ios.deployment_target = '15.5'
  s.swift_version = '5.9'
  s.dependency 'Capacitor'
  s.frameworks = 'Photos'
end
