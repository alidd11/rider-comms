package expo.modules.ridermediacontrols

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

// Controls whatever app is playing music (Spotify, YouTube Music, a podcast
// app) the same way a headset's media buttons do: Android routes the key to
// the active media session. Needs no permission and reads nothing about the
// other app.
//
// Showing what's playing (title, artist, artwork) needs more: Android only
// lists active media sessions to an app whose notification listener the
// rider has turned on in system settings. Until then getNowPlaying returns
// null and the buttons still work through media keys.
class RiderMediaControlsModule : Module() {
  // Artwork is encoded once per track, not on every 3 s poll.
  private var artworkKey: String? = null
  private var artworkUri: String? = null

  override fun definition() = ModuleDefinition {
    Name("RiderMediaControls")

    Function("isOtherAudioPlaying") {
      audioManager()?.isMusicActive ?: false
    }

    Function("sendMediaKey") { key: String ->
      sendKey(key)
    }

    Function("nowPlayingAccess") {
      if (hasListenerAccess()) "granted" else "denied"
    }

    AsyncFunction("requestNowPlayingAccess") {
      val context = appContext.reactContext ?: return@AsyncFunction "denied"
      if (hasListenerAccess()) return@AsyncFunction "granted"
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
          Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
          listenerComponent(context).flattenToString(),
        )
      } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (_: Exception) {
        context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      // The rider decides in system settings; the app re-checks when it
      // comes back to the foreground.
      "denied"
    }

    AsyncFunction("getNowPlaying") {
      val controller = activeController() ?: return@AsyncFunction null
      val metadata = controller.metadata ?: return@AsyncFunction null
      val title = metadata.getString(MediaMetadata.METADATA_KEY_TITLE) ?: ""
      if (title.isEmpty()) return@AsyncFunction null
      val result = mutableMapOf<String, Any>(
        "title" to title,
        "artist" to (metadata.getString(MediaMetadata.METADATA_KEY_ARTIST)
          ?: metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: ""),
        "playing" to (controller.playbackState?.state == PlaybackState.STATE_PLAYING),
        "source" to controller.packageName,
        "appName" to appLabel(controller.packageName),
      )
      val key = "${controller.packageName}\u0000$title\u0000${result["artist"]}"
      if (key != artworkKey) {
        artworkKey = key
        val art = metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
          ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_ART)
        artworkUri = art?.let { artworkDataUri(it) }
      }
      artworkUri?.let { result["artworkUri"] = it }
      result
    }

    AsyncFunction("controlNowPlaying") { key: String ->
      // One lookup, so the play/pause decision and the command go to the same app.
      val controller = activeController() ?: return@AsyncFunction sendKey(key)
      val controls = controller.transportControls
      val playing = controller.playbackState?.state == PlaybackState.STATE_PLAYING
      when (key) {
        "playPause" -> if (playing) controls.pause() else controls.play()
        "next" -> controls.skipToNext()
        "previous" -> controls.skipToPrevious()
        else -> return@AsyncFunction false
      }
      true
    }
  }

  private fun sendKey(key: String): Boolean {
    val code = when (key) {
      "playPause" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
      "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
      "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
      else -> return false
    }
    val manager = audioManager() ?: return false
    manager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
    manager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    return true
  }

  private fun audioManager(): AudioManager? =
    appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  private fun listenerComponent(context: Context) =
    ComponentName(context, RiderNowPlayingListenerService::class.java)

  private fun hasListenerAccess(): Boolean {
    val context = appContext.reactContext ?: return false
    // Same check NotificationManagerCompat.getEnabledListenerPackages does,
    // without pulling in androidx.core.
    val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
    return enabled.split(':').any { ComponentName.unflattenFromString(it)?.packageName == context.packageName }
  }

  /** The session that's playing, else the most recent one. */
  private fun activeController(): MediaController? {
    val context = appContext.reactContext ?: return null
    if (!hasListenerAccess()) return null
    val manager = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager ?: return null
    val sessions = try {
      manager.getActiveSessions(listenerComponent(context))
    } catch (_: SecurityException) {
      return null
    }
    return sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
      ?: sessions.firstOrNull()
  }

  private fun appLabel(packageName: String): String {
    val pm = appContext.reactContext?.packageManager ?: return ""
    return try {
      pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    } catch (_: Exception) {
      ""
    }
  }

  private fun artworkDataUri(bitmap: Bitmap): String {
    val scaled = Bitmap.createScaledBitmap(bitmap, 96, 96, true)
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 70, out)
    return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}
