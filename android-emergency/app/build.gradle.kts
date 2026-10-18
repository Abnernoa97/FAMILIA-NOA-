plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseKeystorePath = System.getenv("FAMILIA_NOA_KEYSTORE_PATH")
val releaseKeystorePassword = System.getenv("FAMILIA_NOA_KEYSTORE_PASSWORD")

android {
    namespace = "com.familianoa.emergency"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.familianoa.emergency"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "6.0.0"
    }

    signingConfigs {
        create("release") {
            if (!releaseKeystorePath.isNullOrBlank() && !releaseKeystorePassword.isNullOrBlank()) {
                storeFile = file(releaseKeystorePath)
                storePassword = releaseKeystorePassword
                keyAlias = "familia-noa-release"
                keyPassword = releaseKeystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
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
