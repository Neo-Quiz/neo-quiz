package com.ahmedmili.neoquiz.bridge

import androidx.core.content.FileProvider

/**
 * The FileProvider of the share sheet, a class of its own so that its authority
 * (`<applicationId>.share`) and its paths (`share_paths.xml`: only `cache/share/`)
 * are not those of the provider that opens quiz-folder files (`systeme.ouvrir`).
 */
class ShareFileProvider : FileProvider() {
    companion object {
        fun authority(packageName: String) = "$packageName.share"
    }
}
