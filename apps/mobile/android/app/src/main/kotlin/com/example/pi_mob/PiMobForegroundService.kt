package com.example.pi_mob

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

class PiMobForegroundService: Service(){
  override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
    val notification:Notification=NotificationCompat.Builder(this,"pi_mob_status")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("Pi status connection")
      .setContentText("Background status is enabled")
      .setOngoing(true)
      .build()
    startForeground(1502,notification)
    return START_NOT_STICKY
  }
  override fun onBind(intent:Intent?):IBinder?=null
}
