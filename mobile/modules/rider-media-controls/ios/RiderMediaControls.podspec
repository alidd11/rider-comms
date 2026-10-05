Pod::Spec.new do |s|
  s.name           = 'RiderMediaControls'
  s.version        = '1.0.0'
  s.summary        = 'Music playback state for Rider Comms'
  s.description    = 'Reports whether another app is playing audio.'
  s.license        = 'UNLICENSED'
  s.author         = 'Rider Comms'
  s.homepage       = 'https://alidd11.github.io/rider-comms/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
