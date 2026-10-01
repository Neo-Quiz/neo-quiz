package com.ahmedmili.neoquiz.sync

import com.ahmedmili.neoquiz.bridge.text
import org.json.JSONArray

/**
 * The `sync` group of the bridge, mirror of the verbs of `Pont.sync`
 * (Task 6) plus `sync.scanner`, which exists on Android only (the camera), `sync.ignorer`
 * (Ignore on a pairing request) and `sync.partagerId` (the share sheet):
 * the page reaches those verbs, a scan, and two pushes (`sync.etat`,
 * `sync.donneesRecues`, emitted by the hub's listeners), never a folder, a path, a
 * port, the API key or a REST call. A device id is validated before it reaches
 * a config, and pairing is confirmed in a native dialog the page cannot answer.
 */
class SyncChannel(
    private val backend: SyncBackend,
    private val scanner: suspend () -> String?,
    /** Opens the system share sheet with this device's id (the text is built by the caller, never by the page). */
    private val share: suspend (deviceId: String) -> Boolean = { false },
) {
    private val sharing = SingleFlight()

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "sync.etat" to { _ -> backend.state() },
        "sync.appairer" to { a -> backend.pair(a.text(0)) },
        "sync.oublier" to { a -> backend.forget(a.text(0)) },
        "sync.ignorer" to { a -> backend.ignore(a.text(0)) },
        // The page names a channel and nothing else; the id is OURS, read from the engine, and must be a device id.
        "sync.partagerId" to { a ->
            // Single flight: a second call while the share sheet is being opened returns at once.
            sharing.run(false) {
                val own = backend.state()["appareil"]
                if (a.text(0) == "systeme" && own is String && ShareRules.isDeviceId(own)) share(own) else false
            }
        },
        "sync.scanner" to { _ -> scanner() },
    )
}
