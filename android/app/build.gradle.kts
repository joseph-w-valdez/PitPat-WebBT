plugins {
    id("com.android.application")
}

android {
    namespace = "com.pitpat.webbt"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pitpat.webbt"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

val webAssets = layout.buildDirectory.dir("generated/webassets")

tasks.register<Copy>("copyWebAssets") {
    from(rootProject.layout.projectDirectory.file("../index.html"))
    from(rootProject.layout.projectDirectory.file("../treadmill.js"))
    into(webAssets)
}

android.sourceSets.getByName("main").assets.srcDir(webAssets)

tasks.named("preBuild").configure {
    dependsOn("copyWebAssets")
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
}
