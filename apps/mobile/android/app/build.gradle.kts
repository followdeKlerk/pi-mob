import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Preview builds remain installable without a repository-owned Firebase
// project. Push notifications are enabled only when the operator or release
// environment supplies the non-secret Firebase Android configuration.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Release credentials must come from outside the repository. Operators can
// pass -PreleaseProperties=/absolute/path/release.properties or the
// ANDROID_RELEASE_PROPERTIES environment variable. The file must contain:
// storeFile, storePassword, keyAlias, keyPassword.
val releaseProperties = Properties()
val releasePropertiesPath = providers.gradleProperty("releaseProperties").orNull
    ?: providers.environmentVariable("ANDROID_RELEASE_PROPERTIES").orNull
if (releasePropertiesPath != null) {
    val propertiesFile = file(releasePropertiesPath)
    require(propertiesFile.isFile) { "Release signing properties file does not exist: $releasePropertiesPath" }
    propertiesFile.inputStream().use { input -> releaseProperties.load(input) }
}
fun nonBlank(value: String?): String? = if (value != null && value.isNotBlank()) value else null
fun releaseValue(property: String, environment: String): String? =
    nonBlank(releaseProperties.getProperty(property))
        ?: nonBlank(providers.gradleProperty(property).orNull)
        ?: nonBlank(providers.environmentVariable(environment).orNull)

val releaseStoreFile = releaseValue("storeFile", "ANDROID_RELEASE_KEYSTORE")
val releaseStorePassword = releaseValue("storePassword", "ANDROID_RELEASE_STORE_PASSWORD")
val releaseKeyAlias = releaseValue("keyAlias", "ANDROID_RELEASE_KEY_ALIAS")
val releaseKeyPassword = releaseValue("keyPassword", "ANDROID_RELEASE_KEY_PASSWORD")
val releaseSigningReady = listOf(releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { it != null }
val requestedReleaseTask = gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }
check(!requestedReleaseTask || releaseSigningReady) {
    "Release signing is fail-closed. Supply an external releaseProperties file or all ANDROID_RELEASE_* values."
}

android {
    // Stable preview identity. Keep aligned with Firebase and Kotlin package paths.
    namespace = "com.example.pi_mob"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Stable preview identity: changing this requires coordinated Firebase and deep-link migration.
        applicationId = "com.example.pi_mob"
        // pi-mob M1: lock the floor to API 29 per docs/TOOLCHAIN.md. Flutter's
        // generated `flutter.minSdkVersion` is intentionally not used here so
        // that the floor survives Flutter SDK updates.
        minSdk = 29
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (releaseSigningReady) {
                storeFile = file(requireNotNull(releaseStoreFile))
                storePassword = requireNotNull(releaseStorePassword)
                keyAlias = requireNotNull(releaseKeyAlias)
                keyPassword = requireNotNull(releaseKeyPassword)
            }
        }
    }

    buildTypes {
        release {
            // Never fall back to the debug key. Missing credentials fail above.
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("com.google.firebase:firebase-messaging:25.0.1")
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
