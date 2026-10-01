package com.ahmedmili.neoquiz.sync

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Orphan detection on a fake `/proc`: only OUR binary launched with OUR home is ever a target. */
class ProcTableTest {
    private val proc: File = Files.createTempDirectory("proc").toFile()
    private val home = "/data/user/0/com.ahmedmili.neoquiz/files/syncthing"

    private fun process(pid: Int, vararg args: String) {
        val dir = File(proc, pid.toString()).apply { mkdirs() }
        File(dir, "cmdline").writeBytes((args.joinToString("\u0000") + "\u0000").toByteArray())
    }

    private val ours = "/data/app/~~x/com.ahmedmili.neoquiz-y/lib/arm64/libsyncthingnative.so"

    @Test fun findsTheWrapperAndItsChildButNothingElse() {
        process(100, ours, "serve", "--home=$home", "--no-browser")
        process(101, ours, "serve", "--home=$home", "--no-browser")
        process(102, ours, "serve", "--home=/another/home")
        process(103, "/system/bin/sh", "--home=$home")
        process(104, "/data/app/other/libsyncthingnative.so.bak", "--home=$home")
        File(proc, "self").mkdirs()
        assertEquals(listOf(100, 101), ProcTable.findOurs(proc, home))
    }

    @Test fun isOursChecksTheBinaryNameAndTheHome() {
        process(7, ours, "serve", "--home=$home")
        assertTrue(ProcTable.isOurs(proc, 7, home))
        assertFalse("another home", ProcTable.isOurs(proc, 7, "$home-2"))
        assertFalse("a vanished pid", ProcTable.isOurs(proc, 8, home))
        process(9, "/system/bin/app_process", "--home=$home")
        assertFalse("a reused pid of another program is never touched", ProcTable.isOurs(proc, 9, home))
    }

    @Test fun releaseHomeKillsTheWrittenPidAndTheScannedOnesAndDeletesTheFile() {
        val h = Files.createTempDirectory("home").toFile()
        process(200, ours, "serve", "--home=${h.path}")
        process(201, ours, "serve", "--home=${h.path}")
        process(202, "/system/bin/sh")
        File(h, SyncthingProcess.PID_FILE).writeText("200")
        val killed = ArrayList<Int>()
        val p = SyncthingProcess(File(ours), h, File(h, "tmp"), proc) { pid ->
            killed.add(pid)
            File(proc, pid.toString()).deleteRecursively()
        }
        assertEquals(listOf(200, 201), p.releaseHome().sorted())
        assertEquals(listOf(200, 201), killed.sorted())
        assertFalse(File(h, SyncthingProcess.PID_FILE).exists())
        assertTrue("an unrelated process survives", File(proc, "202").exists())
    }

    @Test fun aPidFileNamingAnotherProgramKillsNothing() {
        val h = Files.createTempDirectory("home").toFile()
        process(300, "/system/bin/sh")
        File(h, SyncthingProcess.PID_FILE).writeText("300")
        val killed = ArrayList<Int>()
        SyncthingProcess(File(ours), h, File(h, "tmp"), proc) { killed.add(it) }.releaseHome()
        assertTrue(killed.isEmpty())
    }
}
