package com.ahmedmili.neoquiz.notify

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.app.Notification
import com.ahmedmili.neoquiz.MainActivity
import com.ahmedmili.neoquiz.R
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * The daily review notification. One INEXACT alarm (`setAndAllowWhileIdle`: no exact-alarm permission) a
 * day, at 07:00 local; the receiver READS the table the page precomputed (`DueCalendar`), notifies when
 * today's count is above zero, and arms the next day. Re-armed after boot and after an app update, and
 * every time the page saves a new table. Vendors such as HyperOS may delay an inexact alarm by minutes
 * or more: accepted, nothing here depends on the minute.
 */
object ReviewAlarm {
    const val HOUR = 7
    const val ACTION_FIRE = "com.ahmedmili.neoquiz.REVIEW_ALARM"
    const val EXTRA_OPEN_REVIEW = "openReview"
    private const val CHANNEL_ID = "review"
    private const val NOTIFICATION_ID = 2

    /** The next 07:00 strictly after `now`, built from the calendar (never `+ 24 h`: a daylight saving day is 23 or 25 h). */
    fun nextTrigger(now: ZonedDateTime): ZonedDateTime {
        val today = now.toLocalDate().atTime(HOUR, 0).atZone(now.zone)
        return if (today.isAfter(now)) today else now.toLocalDate().plusDays(1).atTime(HOUR, 0).atZone(now.zone)
    }

    fun scheduleNext(context: Context) = scheduleAt(context, nextTrigger(ZonedDateTime.now()).toInstant().toEpochMilli())

    fun scheduleAt(context: Context, atMillis: Long) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, firePending(context))
    }

    private fun firePending(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, 0,
        Intent(context, ReviewAlarmReceiver::class.java).setAction(ACTION_FIRE),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** Notifies when the table says something is due today; no entry, an unreadable table or 0 due: nothing. */
    fun notifyIfDue(context: Context, today: LocalDate = LocalDate.now(ZoneId.systemDefault())) {
        val calendar = DueCalendar.of(context)
        val due = calendar.dueOn(today.toString())?.takeIf { it > 0 } ?: return
        val texts = calendar.texts() ?: return
        if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, context.getString(R.string.review_channel_name), NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            context, 1,
            Intent(context, MainActivity::class.java).putExtra(EXTRA_OPEN_REVIEW, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.notify(
            NOTIFICATION_ID,
            Notification.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(texts.title)
                .setContentText(texts.body(due))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build(),
        )
    }
}

/** The alarm itself, and the two moments the system forgets it (boot, app update). */
class ReviewAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ReviewAlarm.ACTION_FIRE -> {
                try {
                    ReviewAlarm.notifyIfDue(context)
                } finally {
                    ReviewAlarm.scheduleNext(context)
                }
            }
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> ReviewAlarm.scheduleNext(context)
        }
    }
}
