package com.ahmedmili.neoquiz.ui

import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView
import com.ahmedmili.neoquiz.R

/** True once "All files access" is granted (the quiz folder lives in shared storage). minSdk is 30: the setting always exists. */
fun hasAllFilesAccess(): Boolean = Environment.isExternalStorageManager()

/** True once the app is exempt from battery optimisation, so the embedded sync keeps running in the background. */
fun hasBackgroundSync(context: Context): Boolean =
    context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)

private const val PREFS = "first_run"
private const val KEY_DONE = "done"

/** The user tapped "Get started" once: the optional background step is never asked again. */
fun isFirstRunDone(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_DONE, false)

private fun markFirstRunDone(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_DONE, true).apply()

// The palette of the Windows installer (apps/windows/installer/style*.css), so both first screens match.
private const val TEXT = 0xFFF5F7FF.toInt()
private const val MUTED = 0xFFAAB6D3.toInt()
private const val ACCENT = 0xFF5B9DFF.toInt()
private const val ON_ACCENT = 0xFF061224.toInt()
private const val LINE = 0x5779_97CF // rgba(121, 151, 207, .34)

/**
 * The first-run screen: two steps over the installer's backdrop. Step 1 ("All files access") is
 * required: the quizzes are plain files in Documents/Neo Quiz. Step 2 (background sync, i.e. no
 * battery optimisation) is optional and opens the system list where the user picks the app: no
 * permission is needed for that. "Get started" unlocks once step 1 is done; the activity re-checks
 * both on resume (coming back from a setting) and calls [refresh].
 */
class FirstRunScreen(context: Context, private val onStart: () -> Unit) : ScrollView(context) {
    private val filesBadge: ImageView
    private val filesNumber: TextView
    private val filesButton: TextView
    private val filesDone: TextView
    private val syncBadge: ImageView
    private val syncNumber: TextView
    private val syncButton: TextView
    private val syncDone: TextView
    private val startButton: TextView

    init {
        // AndroidView sizes a view by its layout params: without them the screen wrapped to 144 px wide.
        layoutParams = android.view.ViewGroup.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        isFillViewport = true
        overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(20), dp(24), dp(24))
        }
        addView(column, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        // Brand row, on the dark top-left of the backdrop.
        column.addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(context).apply { setImageResource(R.mipmap.ic_launcher) }, LinearLayout.LayoutParams(dp(36), dp(36)))
            addView(text("Neo Quiz", 17f, TEXT, 600).apply { setPadding(dp(10), 0, 0, 0) })
        })

        // The swirl of the backdrop shows above the text.
        column.addView(Space(context), LinearLayout.LayoutParams(0, 0, 1f))

        column.addView(text(context.getString(R.string.first_run_title), 30f, TEXT, 600))
        column.addView(text(context.getString(R.string.first_run_intro), 16f, MUTED, 400).apply {
            setPadding(0, dp(8), 0, dp(28))
            setLineSpacing(0f, 1.15f)
        })

        val files = step(1, R.string.first_run_files_title, null, R.string.first_run_files_body, R.string.first_run_files_button, R.string.first_run_files_done, true) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}")))
        }
        filesBadge = files.badge; filesNumber = files.number; filesButton = files.button; filesDone = files.done
        column.addView(files.root)

        val sync = step(2, R.string.first_run_sync_title, R.string.first_run_optional, R.string.first_run_sync_body, R.string.first_run_sync_button, R.string.first_run_sync_done, false) {
            // The one-tap system dialog for THIS app; the generic list made the user hunt for it
            // among every installed app. Falls back to the app's own settings page if a vendor
            // build does not handle the request.
            val pkg = Uri.parse("package:${context.packageName}")
            try {
                context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg))
            } catch (_: android.content.ActivityNotFoundException) {
                context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg))
            }
        }
        syncBadge = sync.badge; syncNumber = sync.number; syncButton = sync.button; syncDone = sync.done
        column.addView(sync.root, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(24) })

        startButton = button(context.getString(R.string.first_run_start), true).apply {
            gravity = Gravity.CENTER
            setOnClickListener {
                markFirstRunDone(context)
                onStart()
            }
        }
        column.addView(startButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(32) })
        refresh(files = false, sync = false)
    }

    /** Shows each step as done or to do; "Get started" is enabled once the files step is done. */
    fun refresh(files: Boolean, sync: Boolean) {
        show(files, filesBadge, filesNumber, filesButton, filesDone)
        show(sync, syncBadge, syncNumber, syncButton, syncDone)
        startButton.isEnabled = files
        startButton.alpha = if (files) 1f else 0.4f
    }

    private fun show(done: Boolean, badge: ImageView, number: TextView, button: TextView, doneLabel: TextView) {
        badge.visibility = if (done) View.VISIBLE else View.GONE
        number.visibility = if (done) View.GONE else View.VISIBLE
        button.visibility = if (done) View.GONE else View.VISIBLE
        doneLabel.visibility = if (done) View.VISIBLE else View.GONE
    }

    private class Step(val root: View, val badge: ImageView, val number: TextView, val button: TextView, val done: TextView)

    /** A numbered step: a round marker (its number, or a check once done), a title, a text and one action. */
    private fun step(n: Int, title: Int, tag: Int?, body: Int, action: Int, doneText: Int, primary: Boolean, act: () -> Unit): Step {
        val marker = FrameLayout(context)
        val number = text(n.toString(), 14f, TEXT, 600).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(1), 0x9979_97CF.toInt()) }
        }
        val badge = ImageView(context).apply {
            setImageResource(R.drawable.ic_first_run_check)
            imageTintList = ColorStateList.valueOf(ON_ACCENT)
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(ACCENT) }
        }
        marker.addView(number, FrameLayout.LayoutParams(dp(28), dp(28)))
        marker.addView(badge, FrameLayout.LayoutParams(dp(28), dp(28)))

        val texts = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(text(context.getString(title), 17f, TEXT, 600))
            if (tag != null) addView(text(context.getString(tag), 13f, MUTED, 400).apply { setPadding(dp(8), 0, 0, 0) })
        })
        texts.addView(text(context.getString(body), 15f, MUTED, 400).apply {
            setPadding(0, dp(4), 0, dp(12))
            setLineSpacing(0f, 1.15f)
        })
        val button = button(context.getString(action), primary).apply { setOnClickListener { act() } }
        texts.addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(44)))
        val done = text(context.getString(doneText), 15f, ACCENT, 600)
        texts.addView(done)

        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(marker, LinearLayout.LayoutParams(dp(28), dp(28)).apply { marginEnd = dp(14) })
        row.addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        return Step(row, badge, number, button, done)
    }

    /** Primary: filled with the accent, dark text (the installer's button). Secondary: accent text, a thin outline. */
    private fun button(label: String, primary: Boolean): TextView = text(label, 15f, if (primary) ON_ACCENT else ACCENT, 600).apply {
        gravity = Gravity.CENTER
        setPadding(dp(20), 0, dp(20), 0)
        isClickable = true
        isFocusable = true
        val shape = GradientDrawable().apply {
            cornerRadius = dp(12).toFloat()
            if (primary) setColor(ACCENT) else { setColor(Color.TRANSPARENT); setStroke(dp(1), LINE) }
        }
        val mask = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(Color.WHITE) }
        background = RippleDrawable(ColorStateList.valueOf(if (primary) 0x33061224 else 0x335B9DFF), shape, mask)
    }

    private fun text(value: String, size: Float, color: Int, weight: Int) = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(color)
        typeface = Typeface.create(Typeface.DEFAULT, weight, false)
        isAllCaps = false // never all-caps labels
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density + 0.5f).toInt()
}

/**
 * The installer's backdrop (apps/windows/installer/fond.png) as the window background of the
 * first-run screen, so it also shows under the status and navigation bars. The image is anchored
 * top-right and scaled to cover at least the top 60 % of a portrait screen (the full width in
 * landscape); its last quarter fades into its own bottom-right colour, which fills the rest.
 */
class FirstRunBackdrop(context: Context) : Drawable() {
    private val bitmap: Bitmap = BitmapFactory.decodeResource(context.resources, R.drawable.first_run_backdrop)
    private val base = bitmap.getPixel(bitmap.width - 1, bitmap.height - 1) or 0xFF000000.toInt()
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val fade = Paint()
    private val matrix = Matrix()
    private var imageBottom = 0f
    private var fadeTop = 0f

    override fun onBoundsChange(bounds: android.graphics.Rect) {
        val w = bounds.width().toFloat()
        val h = bounds.height().toFloat()
        val scale = maxOf(w / bitmap.width, 0.6f * h / bitmap.height)
        matrix.setScale(scale, scale)
        matrix.postTranslate(bounds.right - bitmap.width * scale, bounds.top.toFloat())
        imageBottom = bounds.top + bitmap.height * scale
        fadeTop = imageBottom - bitmap.height * scale * 0.25f
        fade.shader = LinearGradient(0f, fadeTop, 0f, imageBottom, base and 0x00FFFFFF, base, Shader.TileMode.CLAMP)
    }

    override fun draw(canvas: Canvas) {
        canvas.drawColor(base)
        canvas.drawBitmap(bitmap, matrix, paint)
        canvas.drawRect(bounds.left.toFloat(), fadeTop, bounds.right.toFloat(), imageBottom + 1f, fade)
    }

    override fun setAlpha(alpha: Int) = Unit
    override fun setColorFilter(colorFilter: ColorFilter?) = Unit
    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.OPAQUE
}
