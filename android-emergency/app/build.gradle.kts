val permanentKeystorePath = System.getenv("FAMILIA_NOA_ANDROID_KEYSTORE_PATH")
val permanentKeystorePassword = System.getenv("FAMILIA_NOA_ANDROID_KEYSTORE_PASSWORD")

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.familianoa.emergency"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.familianoa.emergency"
        minSdk = 26
        targetSdk = 35
        versionCode = 19
        versionName = "7.1.10"
    }

    signingConfigs {
        if (!permanentKeystorePath.isNullOrBlank() && !permanentKeystorePassword.isNullOrBlank()) {
            create("permanentRelease") {
                storeFile = file(permanentKeystorePath)
                storePassword = permanentKeystorePassword
                keyAlias = "familia-noa"
                keyPassword = permanentKeystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("permanentRelease")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.core:core-ktx:1.15.0")
}
