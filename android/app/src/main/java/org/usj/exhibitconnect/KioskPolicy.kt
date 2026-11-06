package org.usj.exhibitconnect

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.ActivityInfo
import android.os.Build

object KioskPolicy {
    const val ORIENTATION_LANDSCAPE = "landscape"
    const val ORIENTATION_LANDSCAPE_REV = "landscape_reverse"
    const val ORIENTATION_PORTRAIT = "portrait"
    const val ORIENTATION_PORTRAIT_REV = "portrait_reverse"

    fun activityInfo(value: String): Int = when (value) {
        ORIENTATION_PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        ORIENTATION_PORTRAIT_REV -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
        ORIENTATION_LANDSCAPE_REV -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
        else -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
    }

    fun admin(context: Context) = ComponentName(context, AdminReceiver::class.java)

    fun isDeviceOwner(context: Context): Boolean {
        val dpm = context.getSystemService(DevicePolicyManager::class.java) ?: return false
        return dpm.isDeviceOwnerApp(context.packageName)
    }

    /** Blocks notification shade / status bar when this app is device owner. */
    fun apply(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java) ?: return
        val who = admin(context)
        try {
            dpm.setLockTaskPackages(who, arrayOf(context.packageName))
        } catch (_: Exception) {
        }
        try {
            dpm.setStatusBarDisabled(who, true)
        } catch (_: Exception) {
        }
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                dpm.setLockTaskFeatures(who, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
            } catch (_: Exception) {
            }
        }
        if (Build.VERSION.SDK_INT >= 23) {
            try {
                dpm.setKeyguardDisabled(who, true)
            } catch (_: Exception) {
            }
        }
    }
}
