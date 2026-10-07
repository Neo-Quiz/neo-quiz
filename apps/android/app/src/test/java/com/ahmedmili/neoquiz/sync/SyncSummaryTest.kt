package com.ahmedmili.neoquiz.sync

import com.ahmedmili.neoquiz.sync.SyncSummary.Kind
import org.junit.Assert.assertEquals
import org.junit.Test

class SyncSummaryTest {
    private fun dev(connected: Boolean, paused: Boolean = false) =
        mapOf("connecte" to connected, "enPause" to (if (paused) true else null))

    private fun state(folder: String, percent: Int? = null, vararg devices: Map<String, Any?>, active: Boolean = true) =
        mapOf("actif" to active, "appareils" to devices.toList(), "dossier" to mapOf("etat" to folder, "pourcentage" to percent))

    @Test fun noStateYetIsStarting() = assertEquals(Kind.STARTING, SyncSummary.of(null).kind)

    @Test fun syncingShowsPercentAndConnectedDevices() =
        assertEquals(SyncSummary(Kind.SYNCING, 97, 1), SyncSummary.of(state("syncing", 97, dev(true), dev(false))))

    @Test fun syncingWithoutPercentKeepsTheKind() = assertEquals(SyncSummary(Kind.SYNCING, null, 1), SyncSummary.of(state("syncing", null, dev(true))))

    @Test fun idleWithDevicesIsUpToDate() = assertEquals(SyncSummary(Kind.UP_TO_DATE, null, 2), SyncSummary.of(state("idle", null, dev(true), dev(true))))

    @Test fun scanningComesFirst() = assertEquals(Kind.SCANNING, SyncSummary.of(state("scanning", null, dev(false))).kind)

    @Test fun nobodyConnectedWhateverTheFolderIdles() {
        assertEquals(Kind.NO_DEVICE, SyncSummary.of(state("idle", null, dev(false))).kind)
        assertEquals(Kind.NO_DEVICE, SyncSummary.of(state("idle")).kind)
        assertEquals(Kind.NO_DEVICE, SyncSummary.of(state("syncing", 50, dev(false))).kind)
    }

    @Test fun inactiveOrAllDevicesPausedIsPaused() {
        assertEquals(Kind.PAUSED, SyncSummary.of(state("idle", null, dev(true), active = false)).kind)
        assertEquals(Kind.PAUSED, SyncSummary.of(state("idle", null, dev(true, true), dev(false, true))).kind)
        assertEquals(Kind.UP_TO_DATE, SyncSummary.of(state("idle", null, dev(true), dev(false, true))).kind)
    }

    @Test fun aFolderErrorIsShown() = assertEquals(Kind.ERROR, SyncSummary.of(state("error", null, dev(true))).kind)

    @Test fun theEnginesAbsentStateIsPaused() = assertEquals(Kind.PAUSED, SyncSummary.of(SyncEngine.ABSENT).kind)
}
