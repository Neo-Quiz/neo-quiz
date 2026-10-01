package com.ahmedmili.neoquiz.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChooserRulesTest {
    @Test fun onlyZipAndMarkdownNamesPass() {
        for (n in listOf("XTI301 - Écosystème Python.zip", "CM1.md", "A.ZIP", "b.Md", "x (1).zip")) assertTrue(n, ChooserRules.acceptsName(n))
        for (n in listOf("setup.apk", "x.exe", "x.zip.apk", "x", ".zip", "", "  ", null, "notes.txt", "x.zip.")) assertFalse(n.toString(), ChooserRules.acceptsName(n))
    }

    @Test fun thePagesAcceptListBecomesMimeTypes() {
        val zip = ChooserRules.mimeTypes(arrayOf(".zip,application/zip")).toSet()
        assertTrue("application/zip" in zip)
        assertFalse("text/markdown" in zip)
        val both = ChooserRules.mimeTypes(arrayOf(".md,.zip,text/markdown,application/zip")).toSet()
        assertTrue(both.containsAll(setOf("application/zip", "text/markdown")))
        // The generic type is always offered: the name check decides, the filter is a hint.
        assertTrue("application/octet-stream" in both)
        assertEquals(setOf("application/octet-stream"), ChooserRules.mimeTypes(arrayOf("image/*")).toSet())
    }
}
