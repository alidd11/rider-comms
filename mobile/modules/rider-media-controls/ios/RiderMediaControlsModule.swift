import AVFoundation
import ExpoModulesCore

// iOS has no public API for one app to play, pause or skip another app's
// music, so only playback state is offered here. Riders control music from
// their helmet or headset buttons, or the music app itself.
public class RiderMediaControlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RiderMediaControls")

    Function("isOtherAudioPlaying") { () -> Bool in
      AVAudioSession.sharedInstance().isOtherAudioPlaying
    }

    Function("sendMediaKey") { (_: String) -> Bool in
      false
    }
  }
}
