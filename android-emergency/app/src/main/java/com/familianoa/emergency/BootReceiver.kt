package com.familianoa.emergency

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context:Context, intent:Intent?) {
        if (SessionStore(context).configured) EmergencyService.start(context)
    }
}
