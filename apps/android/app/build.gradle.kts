import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Release signing material lives OUTSIDE the repo. `keystore.properties`
// (storeFile, keyAlias) is read from NEOQUIZ_KEYSTORE_DIR and the password
// from NEOQUIZ_KEYSTORE_PASSWORD (set for the child process only by
// scripts/with-keystore-password.ps1). If either is missing, the release
// build gets no signing config; debug builds are unaffected.
val keystoreDir: String = System.getenv("NEOQUIZ_KEYSTORE_DIR") ?: (System.getProperty("user.home") + "/Keys/neo-quiz")
val keystorePassword: String? = System.getenv("NEOQUIZ_KEYSTORE_PASSWORD")
val keystoreProps = Properties().apply {
    val f = File(keystoreDir, "keystore.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}
val canSignRelease = !keystorePassword.isNullOrEmpty() &&
    keystoreProps.getProperty("storeFile") != null &&
    keystoreProps.getProperty("keyAlias") != null

android {
    namespace = "com.ahmedmili.neoquiz"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ahmedmili.neoquiz"
        minSdk = 30
        targetSdk = 35
        versionCode = 12
        versionName = "0.2.10"
        ndk { abiFilters += "arm64-v8a" }
    }

    signingConfigs {
        if (canSignRelease) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystorePassword
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystorePassword
            }
        }
    }

    buildTypes {
        // The emulator is x86_64: DEBUG builds carry the x86_64 Syncthing too (src/debug/jniLibs, see
        // web/pins.mjs); release builds ship arm64-v8a only.
        debug { ndk { abiFilters += "x86_64" } }
        release {
            isMinifyEnabled = false
            if (canSignRelease) signingConfig = signingConfigs.getByName("release")
        }
    }

    // The bundled Pyodide stdlib is already deflated (zip): storing it again would only cost a second inflate.
    androidResources { noCompress += "zip" }
    packaging { jniLibs { useLegacyPackaging = true } }
    buildFeatures { compose = true }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.webkit)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.play.services.code.scanner)
    implementation(libs.androidx.fragment)
    testImplementation(libs.junit)
    testImplementation(libs.org.json)
}
