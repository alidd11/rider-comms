package expo.modules.ridermediacontrols

import android.content.Context
import android.media.AudioManager
import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Controls whatever app is playing music (Spotify, YouTube Music, a podcast
// app) the same way a headset's media buttons do: Android routes the key to
// the active media session. Needs no permission and reads nothing about the
// other app.
class RiderMediaControlsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RiderMediaControls")

    Function("isOtherAudioPlaying") {
      audioManager()?.isMusicActive ?: false
    }

    Function("sendMediaKey") { key: String ->
      val code = when (key) {
        "playPause" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
        "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
        "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
        else -> return@Function false
      }
      val manager = audioManager() ?: return@Function false
      manager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
      manager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
      true
    }
  }

  private fun audioManager(): AudioManager? =
    appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
}
