package com.ahmedmili.neoquiz.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.ahmedmili.neoquiz.MainActivity
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray

/** Raises the "Quiz ready" notification from the sync service, with the app closed. */
object ChatNotifier {
    const val EXTRA_OPEN_QUIZ = "openQuiz"
    private const val CHANNEL_ID = "chats"
    private const val PREFS = "neo-quiz-chat-notify"
    private const val MAX_TITLE = 80
    private val running = AtomicBoolean(false)

    /** The private storage the channel (page) and the scan (service) share. */
    fun store(context: Context): ChatNotifyChannel.Store {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return object : ChatNotifyChannel.Store {
            override fun get(key: String): String? = prefs.getString(key, null)
            override fun put(key: String, value: String?) { prefs.edit().putString(key, value).apply() }
        }
    }

    /** Never asks for the permission (the app's own flow owns that): it only looks. */
    private fun canNotify(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        return context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() == true
    }

    fun scan(context: Context, root: File) {
        if (!running.compareAndSet(false, true)) return
        try {
            val store = store(context)
            val ownId = store.get(ChatNotifyChannel.KEY_DEVICE) ?: return
            val texts = ChatNotifyChannel.Texts.parse(store.get(ChatNotifyChannel.KEY_TEXTS)) ?: ChatNotifyChannel.Texts.DEFAULT
            val dir = File(root, ".neo-quiz/chats")
            val names = dir.list()?.filter { ChatNotifyRules.readable(it, ownId) } ?: return
            val found = names.flatMap { name ->
                val f = File(dir, name)
                // Size in bytes first: an oversized foreign file is never read.
                if (!f.isFile || f.length() > ChatNotifyRules.MAX_FILE_BYTES) emptyList() else ChatNotifyRules.parse(f.readText(), ownId)
            }
            val notified = store.get(ChatNotifyChannel.KEY_NOTIFIED)?.let { s -> JSONArray(s).let { a -> (0 until a.length()).map { a.getString(it) } } } ?: emptyList()
            val (fresh, next) = ChatNotifyRules.select(found, notified)
            if (fresh.isEmpty()) return
            // Permission first: with it off, nothing is marked, so nothing is lost.
            if (!canNotify(context)) return
            // Marked before raising: a crash while raising loses a notification, it never repeats one.
            store.put(ChatNotifyChannel.KEY_NOTIFIED, JSONArray(next).toString())
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, ChatNotifyChannel.cut(texts.channel, MAX_TITLE), NotificationManager.IMPORTANCE_DEFAULT))
            fresh.forEach { p ->
                val id = p.key.hashCode()
                // Explicit component, immutable; the only data is a validated relative path.
                val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                p.path?.takeIf { ChatNotifyRules.isCleanRelativePath(it) }?.let { open.putExtra(EXTRA_OPEN_QUIZ, it) }
                val tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                manager.notify(id, Notification.Builder(context, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(ChatNotifyChannel.cut(texts.render(p), MAX_TITLE))
                    .setContentIntent(tap)
                    .setAutoCancel(true)
                    .build())
            }
        } catch (_: Exception) {
            // A malformed or unreadable file must never take the sync service down.
        } finally {
            running.set(false)
        }
    }
}
