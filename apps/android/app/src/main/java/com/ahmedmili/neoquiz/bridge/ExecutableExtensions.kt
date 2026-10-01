package com.ahmedmili.neoquiz.bridge

/**
 * Extensions `systeme.ouvrir` refuses, even inside the perimeter: opening is
 * not a read, and `write` then `ouvrir` (two bounded calls) must never compose
 * an execution. COPY of `EXTENSIONS_EXECUTABLES` in
 * `apps/windows/electron/ressources.ts`; `check:android-pont` fails when the
 * two lists drift. The block between the markers is what it compares.
 */
// WINDOWS-LIST-BEGIN
internal val WINDOWS_EXECUTABLE_EXTENSIONS: Set<String> = setOf(
        "exe", "bat", "cmd", "com", "scr", "pif", "lnk", "js", "jse", "vbs", "vbe", "wsf", "wsh", "hta",
        "msi", "ps1", "reg", "url", "ade", "adp", "app", "application", "appref-ms", "appx", "appxbundle",
        "appinstaller", "bas", "cab", "chm", "cpl", "crt", "csh", "der", "diagcab", "gadget", "grp", "hlp",
        "htc", "inf", "ins", "isp", "its", "jar", "jnlp", "ksh", "library-ms", "mad", "maf", "mag", "mam",
        "maq", "mar", "mas", "mat", "mau", "mav", "maw", "mcf", "mda", "mdb", "mde", "mdt", "mdw", "mdz",
        "msc", "msh", "msh1", "msh2", "mshxml", "msh1xml", "msh2xml", "msix", "msixbundle", "msp", "mst",
        "msu", "ops", "osd", "pcd", "pl", "plg", "prf", "prg", "printerexport", "ps1xml", "ps2", "ps2xml",
        "psc1", "psc2", "psd1", "psm1", "py", "pyc", "pyo", "pyw", "pyz", "pyzw", "scf", "sct", "search-ms",
        "searchconnector-ms", "settingcontent-ms", "shb", "shs", "theme", "vb", "vbp", "vhd", "vhdx",
        "vsmacros", "vsw", "webpnp", "website", "ws", "wsb", "wsc", "xbap", "xll", "xnk", "iso", "img", "rdp",
        "appcontent-ms", "themepack", "deskthemepack", "asx", "cnt", "hpj", "pssc", "psdm1",
)
// WINDOWS-LIST-END

/** What Android installs when it "views" the file: not in the Windows list, refused here too. */
internal val ANDROID_EXECUTABLE_EXTENSIONS: Set<String> = setOf("apk", "apks", "xapk", "apkm")

/**
 * True when `ouvrir` must REFUSE this path. Same reading as `extensionRefusee`
 * (`ressources.ts`): the LAST dot of the name, case ignored, trailing dots and
 * spaces removed (`x.bat.` and `x.bat ` open `x.bat` on Windows, and a synced
 * folder can carry such names), a name that is only an extension (`.bat`) counts,
 * and a `:` in the name (an NTFS stream) is refused outright.
 */
fun extensionRefusee(chemin: String): Boolean {
    val brut = chemin.replace('\\', '/').substringAfterLast('/')
    if (brut.contains(':')) return true
    val nom = brut.trimEnd('.', ' ')
    val point = nom.lastIndexOf('.')
    if (point < 0) return false
    val ext = nom.substring(point + 1).lowercase()
    return ext in WINDOWS_EXECUTABLE_EXTENSIONS || ext in ANDROID_EXECUTABLE_EXTENSIONS
}
