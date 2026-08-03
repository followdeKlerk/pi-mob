package com.example.pi_mob

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.android.FlutterSurfaceView
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
  override fun onFlutterSurfaceViewCreated(flutterSurfaceView: FlutterSurfaceView) {
    super.onFlutterSurfaceViewCreated(flutterSurfaceView)
    window.attributes = window.attributes.also {
      it.preferredRefreshRate = 120f
    }
  }

  private val channelName = "pi-mob/notifications"
  private var tapSink:EventChannel.EventSink?=null
  private var tokenSink:EventChannel.EventSink?=null
  private var pendingPermissionResult:MethodChannel.Result?=null
  private val tokenReceiver=object:BroadcastReceiver(){override fun onReceive(context:Context?,intent:Intent?){intent?.getStringExtra("token")?.let{tokenSink?.success(it)}}}
  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    createStatusChannel()
    EventChannel(flutterEngine.dartExecutor.binaryMessenger,"pi-mob/notification_taps").setStreamHandler(object:EventChannel.StreamHandler{
      override fun onListen(arguments:Any?,events:EventChannel.EventSink?){tapSink=events;deepLink(intent)?.let{events?.success(it)}}
      override fun onCancel(arguments:Any?){tapSink=null}
    })
    ContextCompat.registerReceiver(this,tokenReceiver,IntentFilter(PiMobMessagingService.ACTION_TOKEN),ContextCompat.RECEIVER_NOT_EXPORTED)
    EventChannel(flutterEngine.dartExecutor.binaryMessenger,"pi-mob/notification_tokens").setStreamHandler(object:EventChannel.StreamHandler{
      override fun onListen(arguments:Any?,events:EventChannel.EventSink?){tokenSink=events;getSharedPreferences("pi_mob_notifications",MODE_PRIVATE).getString("fcm_token",null)?.let{events?.success(it)}}
      override fun onCancel(arguments:Any?){tokenSink=null}
    })
    MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
      when(call.method) {
        "permissionStatus" -> result.success(permissionStatus())
        "requestPermission" -> {
          if(Build.VERSION.SDK_INT >= 33 && permissionStatus() == "notDetermined") {
            pendingPermissionResult = result
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1501)
          } else {
            result.success(permissionStatus())
          }
        }
        "currentToken" -> result.success(getSharedPreferences("pi_mob_notifications",MODE_PRIVATE).getString("fcm_token",null))
        "openNotificationSettings" -> { openNotificationSettings(); result.success(null) }
        "setForegroundService" -> {
          val enabled=call.argument<Boolean>("enabled") ?: false
          val visible=call.argument<Boolean>("appVisible") ?: false
          if(enabled && !visible) result.error("invalid_state","Foreground service must start while visible",null)
          else { val intent=Intent(this,PiMobForegroundService::class.java); if(enabled) ContextCompat.startForegroundService(this,intent) else stopService(intent); result.success(null) }
        }
        "updateLiveActivity", "endLiveActivity", "cleanupStaleActivities" -> result.success(null)
        else -> result.notImplemented()
      }
    }
  }
  override fun onRequestPermissionsResult(requestCode:Int, permissions:Array<out String>, grantResults:IntArray){
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if(requestCode == 1501) {
      pendingPermissionResult?.success(permissionStatus())
      pendingPermissionResult = null
    }
  }
  override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);deepLink(intent)?.let{tapSink?.success(it)}}
  private fun openNotificationSettings(){
    val intent=Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply{putExtra(Settings.EXTRA_APP_PACKAGE,packageName)}
    try{startActivity(intent)}catch(_:Exception){startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply{data=android.net.Uri.parse("package:$packageName")})}
  }
  private fun deepLink(intent:Intent?):String?=intent?.dataString ?: intent?.getStringExtra("deepLink")
  override fun onDestroy(){try{unregisterReceiver(tokenReceiver)}catch(_:IllegalArgumentException){};super.onDestroy()}
  private fun permissionStatus():String = if(Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED) "authorized" else if(ActivityCompat.shouldShowRequestPermissionRationale(this,Manifest.permission.POST_NOTIFICATIONS)) "denied" else "notDetermined"
  private fun createStatusChannel(){ if(Build.VERSION.SDK_INT>=26){ val manager=getSystemService(NotificationManager::class.java); manager.createNotificationChannel(NotificationChannel("pi_mob_status","Pi status",NotificationManager.IMPORTANCE_DEFAULT).apply{description="Status-only updates from your Pi host"}) } }
}
