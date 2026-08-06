package com.example.pi_mob

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PiMobMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    getSharedPreferences("pi_mob_notifications", MODE_PRIVATE)
      .edit()
      .putString("fcm_token", token)
      .apply()
    sendBroadcast(Intent(ACTION_TOKEN).setPackage(packageName).putExtra("token", token))
  }

  override fun onMessageReceived(message: RemoteMessage) {
    // FCM displays notification-payload messages automatically while the app
    // is backgrounded. This callback is the foreground/data-only path. Do not
    // create a second system alert while the main activity is visible; the
    // live bridge connection already updates the open chat.
    if (getSharedPreferences(PREFS, MODE_PRIVATE)
        .getBoolean(KEY_APP_FOREGROUND, false)) return
    postStatusNotification(message)
  }

  private fun postStatusNotification(message: RemoteMessage) {
    val data = message.data
    val title = message.notification?.title ?: data["title"] ?: "Pi"
    val body = message.notification?.body ?: data["body"] ?: "Pi status update"
    val deepLink = data["deepLink"] ?: return
    ensureStatusChannel()
    val intent = Intent(this, MainActivity::class.java).apply {
      action = ACTION_NOTIFICATION_TAP
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("deepLink", deepLink)
      this.data = android.net.Uri.parse(deepLink)
    }
    val requestCode = (data["notificationId"] ?: deepLink).hashCode() and 0x7fffffff
    val pendingIntent = PendingIntent.getActivity(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, STATUS_CHANNEL)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle(title)
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .build()
    try {
      NotificationManagerCompat.from(this).notify(requestCode, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS can be denied between token delivery and display.
    }
  }

  private fun ensureStatusChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(
          STATUS_CHANNEL,
          "Pi status",
          NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = "Status-only updates from your Pi host" },
      )
    }
  }

  companion object {
    const val ACTION_TOKEN = "com.example.pi_mob.FCM_TOKEN"
    const val ACTION_NOTIFICATION_TAP = "com.example.pi_mob.NOTIFICATION_TAP"
    const val STATUS_CHANNEL = "pi_mob_status"
    const val PREFS = "pi_mob_notifications"
    const val KEY_APP_FOREGROUND = "app_foreground"
  }
}
