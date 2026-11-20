plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.usj.exhibitconnect"
    compileSdk = 34
    defaultConfig {
        applicationId = "org.usj.exhibitconnect"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "0.2.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
}

val managerSource = rootProject.projectDir.resolve("../packages/manager")
val copyManagerAssets by tasks.registering(Copy::class) {
    from(managerSource) {
        include("manager.html", "manager.js")
    }
    into(layout.projectDirectory.dir("src/main/assets/manager"))
}

tasks.named("preBuild").configure {
    dependsOn(copyManagerAssets)
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.9.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
}
