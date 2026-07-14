import Flutter
import UIKit
import UserNotifications
#if canImport(ActivityKit)
import ActivityKit
#endif

#if canImport(ActivityKit)
@available(iOS 16.1, *)
struct PiMobActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable { var status: String }
  var sessionId: String
}
#endif

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var tokenSink: FlutterEventSink?
  private var tapSink: FlutterEventSink?
  private var pendingDeepLink: String?
  private var deviceToken: String?

  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    if let info=launchOptions?[.remoteNotification] as? [AnyHashable:Any], let link=info["deepLink"] as? String { pendingDeepLink=link }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  override func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    deviceToken = token.map { String(format: "%02.2hhx", $0) }.joined()
    tokenSink?(deviceToken)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "PiMobNotifications")
    let channel = FlutterMethodChannel(name: "pi-mob/notifications", binaryMessenger: registrar.messenger())
    FlutterEventChannel(name: "pi-mob/notification_tokens", binaryMessenger: registrar.messenger()).setStreamHandler(TokenHandler(owner: self))
    FlutterEventChannel(name: "pi-mob/notification_taps", binaryMessenger: registrar.messenger()).setStreamHandler(TapHandler(owner: self))
    channel.setMethodCallHandler { [weak self] call, result in self?.handle(call, result: result) }
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "permissionStatus":
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        result(settings.authorizationStatus == .authorized ? "authorized" : settings.authorizationStatus == .denied ? "denied" : "notDetermined")
      }
    case "requestPermission":
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
        if granted { DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() } }
        result(granted ? "authorized" : "denied")
      }
    case "currentToken": result(deviceToken)
    case "setForegroundService": result(nil) // Android-only.
    case "updateLiveActivity":
      guard #available(iOS 16.1,*), let args=call.arguments as? [String:Any], let sessionId=args["sessionId"] as? String, let status=args["status"] as? String else { result(nil); return }
      Task {
        let content=ActivityContent(state:PiMobActivityAttributes.ContentState(status:status),staleDate:ISO8601DateFormatter().date(from:args["staleAt"] as? String ?? ""))
        if let activity=Activity<PiMobActivityAttributes>.activities.first(where:{$0.attributes.sessionId==sessionId}) { await activity.update(content) }
        else { _ = try? Activity.request(attributes:PiMobActivityAttributes(sessionId:sessionId),content:content,pushType:nil) }
        result(nil)
      }
    case "endLiveActivity":
      guard #available(iOS 16.1,*), let args=call.arguments as? [String:Any], let sessionId=args["sessionId"] as? String else { result(nil); return }
      Task { for activity in Activity<PiMobActivityAttributes>.activities where activity.attributes.sessionId==sessionId { await activity.end(nil,dismissalPolicy:.immediate) }; result(nil) }
    case "cleanupStaleActivities":
      if #available(iOS 16.1,*) { Task { for activity in Activity<PiMobActivityAttributes>.activities { if activity.content.staleDate.map({$0<Date()}) ?? false { await activity.end(nil,dismissalPolicy:.immediate) } }; result(nil) } } else { result(nil) }
    default: result(FlutterMethodNotImplemented)
    }
  }

  override func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    if let link = response.notification.request.content.userInfo["deepLink"] as? String {
      if let sink=tapSink { sink(link) } else { pendingDeepLink=link }
    }
    completionHandler()
  }

  private final class TokenHandler: NSObject, FlutterStreamHandler {
    weak var owner: AppDelegate?; init(owner: AppDelegate){self.owner=owner}
    func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? { owner?.tokenSink=events; if let token=owner?.deviceToken { events(token) }; return nil }
    func onCancel(withArguments arguments: Any?) -> FlutterError? { owner?.tokenSink=nil; return nil }
  }
  private final class TapHandler: NSObject, FlutterStreamHandler {
    weak var owner: AppDelegate?; init(owner: AppDelegate){self.owner=owner}
    func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
      owner?.tapSink=events
      if let link=owner?.pendingDeepLink { events(link); owner?.pendingDeepLink=nil }
      return nil
    }
    func onCancel(withArguments arguments: Any?) -> FlutterError? { owner?.tapSink=nil; return nil }
  }
}
