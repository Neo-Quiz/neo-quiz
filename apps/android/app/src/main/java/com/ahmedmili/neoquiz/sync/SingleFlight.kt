package com.ahmedmili.neoquiz.sync

import java.util.concurrent.atomic.AtomicBoolean

/**
 * One call at a time (like `partage.ts` on Windows): while a call is running, another one returns
 * [busyValue] at once without running its block. Used where a call opens something native (the
 * pairing dialog, the share sheet) that a page must not be able to stack.
 */
class SingleFlight {
    private val busy = AtomicBoolean(false)

    suspend fun <T> run(busyValue: T, block: suspend () -> T): T {
        if (!busy.compareAndSet(false, true)) return busyValue
        try {
            return block()
        } finally {
            busy.set(false)
        }
    }
}
