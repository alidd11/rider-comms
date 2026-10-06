import AVFoundation
import ExpoModulesCore
import MediaPlayer

// iOS has no public API for one app to see or control another app's music,
// with one exception: the Music app (Apple Music and the rider's library),
// through MPMusicPlayerController.systemMusicPlayer once the rider allows
// media library access. Spotify and other apps stay on helmet or headset
// buttons.
public class RiderMediaControlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RiderMediaControls")

    Function("isOtherAudioPlaying") { () -> Bool in
      AVAudioSession.sharedInstance().isOtherAudioPlaying
    }

    Function("sendMediaKey") { (_: String) -> Bool in
      false
    }

    Function("nowPlayingAccess") { () -> String in
      Self.accessName(MPMediaLibrary.authorizationStatus())
    }

    AsyncFunction("requestNowPlayingAccess") { (promise: Promise) in
      MPMediaLibrary.requestAuthorization { status in
        promise.resolve(Self.accessName(status))
      }
    }

    AsyncFunction("getNowPlaying") { () -> [String: Any]? in
      guard MPMediaLibrary.authorizationStatus() == .authorized else { return nil }
      let player = MPMusicPlayerController.systemMusicPlayer
      guard let item = player.nowPlayingItem else { return nil }
      let playing = player.playbackState == .playing
      // A paused Music item while another app plays isn't what the rider
      // is listening to.
      if !playing && AVAudioSession.sharedInstance().isOtherAudioPlaying { return nil }
      var result: [String: Any] = [
        "title": item.title ?? "",
        "artist": item.artist ?? "",
        "playing": playing,
        "source": "apple-music",
        "appName": "Music",
      ]
      if let image = item.artwork?.image(at: CGSize(width: 96, height: 96)),
         let data = image.jpegData(compressionQuality: 0.7) {
        result["artworkUri"] = "data:image/jpeg;base64,\(data.base64EncodedString())"
      }
      return result
    }.runOnQueue(.main)

    AsyncFunction("controlNowPlaying") { (key: String) -> Bool in
      guard MPMediaLibrary.authorizationStatus() == .authorized else { return false }
      let player = MPMusicPlayerController.systemMusicPlayer
      guard player.nowPlayingItem != nil else { return false }
      let playing = player.playbackState == .playing
      // Never start the Music app over Spotify or a podcast.
      if !playing && AVAudioSession.sharedInstance().isOtherAudioPlaying { return false }
      switch key {
      case "playPause":
        if playing { player.pause() } else { player.play() }
      case "next":
        player.skipToNextItem()
      case "previous":
        player.skipToPreviousItem()
      default:
        return false
      }
      return true
    }.runOnQueue(.main)
  }

  private static func accessName(_ status: MPMediaLibraryAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .notDetermined: return "undetermined"
    default: return "denied"
    }
  }
}
