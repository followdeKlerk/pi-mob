package com.example.pi_mob

import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PiMobMessagingService:FirebaseMessagingService(){
  override fun onNewToken(token:String){
    getSharedPreferences("pi_mob_notifications",MODE_PRIVATE).edit().putString("fcm_token",token).apply()
    sendBroadcast(Intent(ACTION_TOKEN).setPackage(packageName).putExtra("token",token))
  }
  override fun onMessageReceived(message:RemoteMessage){
    // Provider notifications are status-only. There are deliberately no
    // action receivers that could mutate a Pi session.
    super.onMessageReceived(message)
  }
  companion object{const val ACTION_TOKEN="com.example.pi_mob.FCM_TOKEN"}
}
