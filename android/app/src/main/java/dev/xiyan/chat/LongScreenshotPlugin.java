package dev.xiyan.chat;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.PixelCopy;
import android.view.Window;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;

/**
 * 会话长图：原生驱动 WebView 内层滚动容器逐屏滚动，用 PixelCopy 抓窗口像素，
 * 再在原生 Bitmap 上拼成一张 PNG，写入缓存目录由前端调起系统分享。
 *
 * 系统的滚动截屏只认原生滚动 View（RecyclerView / ScrollView），WebView 对系统只是
 * 一整块画布，所以长图需要在 App 里自己实现。
 */
@CapacitorPlugin(name = "LongScreenshot")
public class LongScreenshotPlugin extends Plugin {

    private static final String TAG = "LongShot";
    private static final int DEFAULT_MAX_HEIGHT = 20000;
    /** 拼接位图上限，避免长会话直接把进程内存打满。 */
    private static final long MAX_BITMAP_BYTES = 96L * 1024 * 1024;
    /** 等到 WebView 提交新画面后再补一点时间，避免抓到提交前的旧帧。 */
    private static final long FRAME_DELAY = 60L;
    /** 个别设备不回调 postVisualStateCallback，用超时兜底。 */
    private static final long FALLBACK_MILLIS = 1500L;
    /** 抓到的画面和上一屏完全相同时重试，最多重试次数。 */
    private static final int MAX_RETRY = 2;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean busy = false;

    private static final class Capture {
        final PluginCall call;
        final WebView webView;
        final int topPx;
        final int leftPx;
        final int widthPx;
        final int viewportPx;
        final int contentPx;
        final int maxScrollPx;
        final float dpr;
        final boolean truncated;
        final Bitmap stitched;
        final Bitmap shot;
        int offsetPx = 0;
        long lastSignature = Long.MIN_VALUE;

        Capture(
                PluginCall call,
                WebView webView,
                int topPx,
                int leftPx,
                int widthPx,
                int viewportPx,
                int contentPx,
                int maxScrollPx,
                float dpr,
                boolean truncated
        ) {
            this.call = call;
            this.webView = webView;
            this.topPx = topPx;
            this.leftPx = leftPx;
            this.widthPx = widthPx;
            this.viewportPx = viewportPx;
            this.contentPx = contentPx;
            this.maxScrollPx = maxScrollPx;
            this.dpr = dpr;
            this.truncated = truncated;
            this.stitched = Bitmap.createBitmap(widthPx, contentPx, Bitmap.Config.ARGB_8888);
            this.shot = Bitmap.createBitmap(widthPx, viewportPx, Bitmap.Config.ARGB_8888);
        }
    }

    @PluginMethod
    public void capture(PluginCall call) {
        // Capacitor 在独立线程调用插件方法，WebView 和 PixelCopy 都必须在主线程执行。
        if (Looper.myLooper() == Looper.getMainLooper()) {
            captureOnMainThread(call);
        } else {
            handler.post(() -> captureOnMainThread(call));
        }
    }

    private void captureOnMainThread(PluginCall call) {
        if (busy) {
            call.reject("busy");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("unsupported");
            return;
        }
        final WebView webView = getBridge().getWebView();
        if (webView == null) {
            call.reject("not-ready");
            return;
        }
        final Integer requestedMax = call.getInt("maxHeight");
        final int maxHeightPx = requestedMax == null ? DEFAULT_MAX_HEIGHT : requestedMax;
        busy = true;
        webView.evaluateJavascript("window.__xiyanLongShot && window.__xiyanLongShot.metrics()", raw -> {
            JSONObject metrics = parseMetrics(raw);
            if (metrics == null) {
                fail(call, "not-ready");
                return;
            }
            Window window = getActivity() == null ? null : getActivity().getWindow();
            if (window == null || window.getDecorView() == null) {
                fail(call, "not-ready");
                return;
            }
            int decorWidth = window.getDecorView().getWidth();
            int decorHeight = window.getDecorView().getHeight();
            float dpr = (float) metrics.optDouble("dpr", 1.0);
            if (dpr <= 0f) {
                dpr = 1f;
            }
            double widthCss = metrics.optDouble("width", 0.0);
            double heightCss = metrics.optDouble("height", 0.0);
            double contentCss = metrics.optDouble("content", 0.0);
            if (heightCss <= 0 || widthCss <= 0 || contentCss <= heightCss + 4) {
                fail(call, "too-short");
                return;
            }
            int topPx = Math.round((float) metrics.optDouble("top", 0.0) * dpr);
            int leftPx = Math.round((float) metrics.optDouble("left", 0.0) * dpr);
            int viewportPx = Math.round((float) heightCss * dpr);
            int contentPx = Math.round((float) contentCss * dpr);
            int maxScrollPx = Math.round((float) (contentCss - heightCss) * dpr);
            int widthPx = Math.min(Math.round((float) widthCss * dpr), decorWidth);
            // WebView 在窗口里的位置（状态栏高度等）也要算进去，页面坐标不等于窗口坐标。
            int[] origin = new int[2];
            webView.getLocationInWindow(origin);
            topPx += origin[1];
            leftPx += origin[0];
            if (decorWidth <= 0 || decorHeight <= 0 || widthPx <= 0
                    || topPx < 0 || leftPx < 0
                    || leftPx + widthPx > decorWidth
                    || topPx + viewportPx > decorHeight) {
                fail(call, "not-ready");
                return;
            }
            int allowedPx = (int) (MAX_BITMAP_BYTES / (widthPx * 4L));
            int heightLimit = Math.max(viewportPx, Math.min(maxHeightPx, allowedPx));
            int captureHeightPx = Math.min(contentPx, heightLimit);
            Capture capture = new Capture(
                    call,
                    webView,
                    topPx,
                    leftPx,
                    widthPx,
                    viewportPx,
                    captureHeightPx,
                    maxScrollPx,
                    dpr,
                    captureHeightPx < contentPx
            );
            Log.d(TAG, "start widthPx=" + widthPx + " viewportPx=" + viewportPx
                    + " contentPx=" + captureHeightPx + " topPx=" + topPx + " dpr=" + dpr);
            webView.evaluateJavascript(
                    "window.__xiyanLongShot && window.__xiyanLongShot.prepare()",
                    ignored -> nextFrame(capture)
            );
        });
    }

    private void nextFrame(Capture capture) {
        if (capture.offsetPx >= capture.contentPx) {
            finish(capture);
            return;
        }
        int frameHeight = Math.min(capture.viewportPx, capture.contentPx - capture.offsetPx);
        int scrollPx = Math.min(capture.offsetPx, capture.maxScrollPx);
        float scrollCss = scrollPx / capture.dpr;
        Log.d(TAG, "scroll to " + scrollCss + " (offsetPx=" + capture.offsetPx + ")");
        capture.webView.evaluateJavascript(
                "window.__xiyanLongShot && window.__xiyanLongShot.scrollTo(" + scrollCss + ")",
                ignored -> requestGrab(capture, scrollPx, frameHeight, 0)
        );
    }

    /** 等 WebView 真正提交新画面再抓；postVisualStateCallback 不回调时靠超时兜底。 */
    private void requestGrab(Capture capture, int scrollPx, int frameHeight, int attempt) {
        final boolean[] consumed = {false};
        Runnable go = () -> {
            if (consumed[0]) {
                return;
            }
            consumed[0] = true;
            grab(capture, scrollPx, frameHeight, attempt);
        };
        try {
            capture.webView.postVisualStateCallback(
                    System.nanoTime(),
                    new WebView.VisualStateCallback() {
                        @Override
                        public void onComplete(long requestId) {
                            handler.postDelayed(go, FRAME_DELAY);
                        }
                    }
            );
        } catch (Throwable error) {
            Log.d(TAG, "visual state callback unavailable: " + error);
        }
        handler.postDelayed(go, FALLBACK_MILLIS);
    }

    private void grab(Capture capture, int scrollPx, int frameHeight, int attempt) {
        Window window = getActivity() == null ? null : getActivity().getWindow();
        if (window == null || window.getDecorView() == null) {
            abort(capture, "not-ready");
            return;
        }
        Rect source = new Rect(
                capture.leftPx,
                capture.topPx,
                capture.leftPx + capture.widthPx,
                capture.topPx + capture.viewportPx
        );
        long started = System.currentTimeMillis();
        PixelCopy.request(window, source, capture.shot, result -> {
            Log.d(TAG, "pixelcopy attempt=" + attempt + " result=" + result
                    + " took=" + (System.currentTimeMillis() - started) + "ms");
            if (result != PixelCopy.SUCCESS) {
                abort(capture, "save-failed");
                return;
            }
            // 最后一屏受最大滚动距离限制，截图区域要从可视区内部偏移开始。
            int shotTop = capture.offsetPx - scrollPx;
            int shotBottom = Math.min(shotTop + frameHeight, capture.viewportPx);
            int copied = shotBottom - shotTop;
            if (copied <= 0) {
                abort(capture, "save-failed");
                return;
            }
            long signature = signature(capture.shot, shotTop, shotBottom, capture.widthPx);
            if (signature == capture.lastSignature && attempt < MAX_RETRY) {
                Log.d(TAG, "duplicate frame, retry " + (attempt + 1));
                handler.postDelayed(
                        () -> requestGrab(capture, scrollPx, frameHeight, attempt + 1),
                        350L
                );
                return;
            }
            Canvas canvas = new Canvas(capture.stitched);
            canvas.drawBitmap(
                    capture.shot,
                    new Rect(0, shotTop, capture.widthPx, shotBottom),
                    new Rect(0, capture.offsetPx, capture.widthPx, capture.offsetPx + copied),
                    null
            );
            capture.lastSignature = signature;
            capture.offsetPx += copied;
            nextFrame(capture);
        }, handler);
    }

    /** 抽样像素签名，用来识别“还在显示上一屏”的旧画面。 */
    private static long signature(Bitmap bitmap, int top, int bottom, int width) {
        long hash = 1125899906842597L;
        int stepY = Math.max(1, (bottom - top) / 24);
        int stepX = Math.max(1, width / 24);
        for (int y = top; y < bottom; y += stepY) {
            for (int x = 0; x < width; x += stepX) {
                hash = (hash ^ bitmap.getPixel(x, y)) * 1099511628211L;
            }
        }
        return hash;
    }

    private void finish(Capture capture) {
        int width = capture.stitched.getWidth();
        int height = capture.stitched.getHeight();
        String name = "xiyan-longshot-" + System.currentTimeMillis() + ".png";
        File file = new File(getContext().getCacheDir(), name);
        boolean saved = writePng(capture.stitched, file);
        capture.stitched.recycle();
        capture.shot.recycle();
        restore(capture.webView);
        busy = false;
        Log.d(TAG, "finish " + name + " " + width + "x" + height + " saved=" + saved);
        if (!saved) {
            capture.call.reject("save-failed");
            return;
        }
        JSObject result = new JSObject();
        result.put("name", name);
        result.put("width", width);
        result.put("height", height);
        result.put("truncated", capture.truncated);
        capture.call.resolve(result);
    }

    private static boolean writePng(Bitmap bitmap, File file) {
        try (FileOutputStream out = new FileOutputStream(file)) {
            return bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        } catch (Exception error) {
            return false;
        }
    }

    private void abort(Capture capture, String reason) {
        capture.stitched.recycle();
        capture.shot.recycle();
        restore(capture.webView);
        fail(capture.call, reason);
    }

    private void fail(PluginCall call, String reason) {
        busy = false;
        Log.d(TAG, "fail " + reason);
        call.reject(reason);
    }

    private void restore(WebView webView) {
        webView.evaluateJavascript(
                "window.__xiyanLongShot && window.__xiyanLongShot.restore()",
                null
        );
    }

    /** evaluateJavascript 对字符串结果返回带转义的 JSON 字面量，先还原成原文再解析。 */
    private static JSONObject parseMetrics(String raw) {
        if (raw == null || "null".equals(raw) || "undefined".equals(raw)) {
            return null;
        }
        String body = raw;
        if (raw.length() >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) {
            try {
                body = new JSONObject("{\"v\":" + raw + "}").getString("v");
            } catch (Exception error) {
                return null;
            }
        }
        try {
            return new JSONObject(body);
        } catch (Exception error) {
            return null;
        }
    }
}
