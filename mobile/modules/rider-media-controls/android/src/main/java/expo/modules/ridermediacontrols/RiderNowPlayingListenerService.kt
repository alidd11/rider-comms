package expo.modules.ridermediacontrols

import android.service.notification.NotificationListenerService

// Never reads notifications. Android only hands out the list of active media
// sessions (MediaSessionManager.getActiveSessions) to an app with an enabled
// notification listener, so this empty service is the key.
class RiderNowPlayingListenerService : NotificationListenerService()
