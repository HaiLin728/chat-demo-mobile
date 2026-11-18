package dev.xiyan.chat;

import android.graphics.Bitmap;
import android.graphics.HardwareRenderer;
import android.graphics.Paint;
import android.graphics.Point;
import android.graphics.RecordingCanvas;
import android.graphics.Rect;
import android.graphics.RenderNode;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.PixelCopy;
import android.view.ScrollCaptureCallback;
import android.view.ScrollCaptureSession;
import android.view.Window;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.function.Consumer;

/**
 * 让系统截图自带的「截长图」按钮直接可用。
 *
 * 系统只把原生可滚动 View 当作滚动截屏目标，WebView 的页面滚动发生在内层 div 里，
 * 系统看不到；这里实现 Android 14+ 的 ScrollCaptureCallback，按系统请求的坐标
 * 驱动页面滚动，再把窗口像素通过 HardwareRenderer 画进系统提供的 Surface。
 *
 * 请求坐标系的原点是上报的滚动区域（即消息列表可视区）左上角，和 AOSP 的
 * ScrollCaptureViewSupport 一致；上报时用页面里的元素位置乘以 dpr。
 */
final class WebViewScrollCaptureCallback implements ScrollCaptureCallback {

    private static final String TAG = "LongShot";
    /** 滚动后等待 WebView 提交新画面再截图。 */
    private static final long FRAME_DELAY = 70L;
    /** postVisualStateCallback 不回调时的兜底等待。 */
    private static final long FRAME_TIMEOUT = 1500L;

    private static final String JS_METRICS =
            "window.__xiyanLongShot ? window.__xiyanLongShot.metrics() : null";
    private static final String JS_PREPARE =
            "window.__xiyanLongShot && window.__xiyanLongShot.prepare()";
    private static final String JS_RESTORE =
            "window.__xiyanLongShot && window.__xiyanLongShot.restore()";

    private final android.app.Activity activity;
    private final WebView webView;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Paint paint = new Paint();
    private Session session;
    private long sessionToken = 0;

    WebViewScrollCaptureCallback(android.app.Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    private static final class Session {
        ScrollCaptureSession captureSession;
        HardwareRenderer renderer;
        RenderNode node;
        Bitmap shot;
        float dpr = 1f;
        /** 会话开始时的滚动位置与内容高度（设备像素）。 */
        double startPx;
        double contentPx;
        double viewportPx;
        double maxScrollPx;
        Rect bounds = new Rect();
        Point position = new Point();
    }

    @Override
    public void onScrollCaptureSearch(CancellationSignal signal, Consumer<Rect> onReady) {
        if (signal.isCanceled()) {
            return;
        }
        webView.evaluateJavascript(JS_METRICS, raw -> {
            if (signal.isCanceled()) {
                return;
            }
            JSONObject metrics = parseMetrics(raw);
            if (metrics == null) {
                onReady.accept(null);
                return;
            }
            double content = metrics.optDouble("content", 0);
            double height = metrics.optDouble("height", 0);
            if (height <= 0 || content <= height + 4) {
                onReady.accept(null);
                return;
            }
            Rect bounds = elementBounds(metrics, dprOf(metrics));
            if (bounds == null || bounds.isEmpty()) {
                onReady.accept(null);
                return;
            }
            Log.d(TAG, "scroll capture search: " + bounds + " content=" + content);
            onReady.accept(bounds);
        });
    }

    @Override
    public void onScrollCaptureStart(
            ScrollCaptureSession captureSession,
            CancellationSignal signal,
            Runnable onReady
    ) {
        if (signal.isCanceled()) {
            return;
        }
        releaseSession();
        final long token = ++sessionToken;
        final Session current = new Session();
        current.captureSession = captureSession;
        current.bounds.set(captureSession.getScrollBounds());
        Point position = captureSession.getPositionInWindow();
        current.position.set(position.x, position.y);
        session = current;
        webView.evaluateJavascript(JS_PREPARE, ignored ->
                webView.evaluateJavascript(JS_METRICS, raw -> {
                    if (token != sessionToken) {
                        return;
                    }
                    JSONObject metrics = parseMetrics(raw);
                    if (metrics != null && !signal.isCanceled()) {
                        current.dpr = dprOf(metrics);
                        current.startPx = metrics.optDouble("scrollTop", 0) * current.dpr;
                        current.contentPx = metrics.optDouble("content", 0) * current.dpr;
                        current.viewportPx = Math.min(
                                current.bounds.height(),
                                metrics.optDouble("height", 0) * current.dpr
                        );
                        current.maxScrollPx = Math.max(0, current.contentPx - current.viewportPx);
                        current.shot = Bitmap.createBitmap(
                                Math.max(1, current.bounds.width()),
                                Math.max(1, current.bounds.height()),
                                Bitmap.Config.ARGB_8888
                        );
                        current.node = new RenderNode("xiyan-scroll-capture");
                        current.renderer = new HardwareRenderer();
                        current.renderer.setContentRoot(current.node);
                        current.renderer.setSurface(captureSession.getSurface());
                        Log.d(TAG, "start: bounds=" + current.bounds + " startPx=" + current.startPx
                                + " contentPx=" + current.contentPx + " viewportPx=" + current.viewportPx);
                    }
                    onReady.run();
                })
        );
    }

    @Override
    public void onScrollCaptureImageRequest(
            ScrollCaptureSession captureSession,
            CancellationSignal signal,
            Rect requestRect,
            Consumer<Rect> onComplete
    ) {
        final Session current = session;
        if (current == null || current.renderer == null || signal.isCanceled()) {
            onComplete.accept(new Rect());
            return;
        }
        final long token = sessionToken;
        // 请求坐标以列表可视区左上角为原点，换算到页面内容坐标。
        double requestedTop = current.startPx + requestRect.top;
        double requestedBottom = current.startPx + requestRect.bottom;
        double center = (requestedTop + requestedBottom) / 2.0 - current.viewportPx / 2.0;
        double scrollPx = Math.max(0, Math.min(current.maxScrollPx, center));
        double scrollCss = scrollPx / current.dpr;
        Log.d(TAG, "request " + requestRect + " -> scrollCss=" + scrollCss);
        webView.evaluateJavascript(
                "window.__xiyanLongShot ? window.__xiyanLongShot.scrollTo(" + scrollCss + ") : null",
                raw -> {
                    if (token != sessionToken || signal.isCanceled()) {
                        return;
                    }
                    double actualCss = parseNumber(raw);
                    if (Double.isNaN(actualCss)) {
                        onComplete.accept(new Rect());
                        return;
                    }
                    final int actualPx = (int) Math.round(actualCss * current.dpr);
                    final int visibleTop = actualPx;
                    final int visibleBottom = actualPx + (int) Math.round(current.viewportPx);
                    int availableTop = (int) Math.round(Math.max(requestedTop, visibleTop));
                    int availableBottom = (int) Math.round(Math.min(requestedBottom, visibleBottom));
                    availableTop = (int) Math.max(0, availableTop);
                    availableBottom = (int) Math.min(Math.round(current.contentPx), availableBottom);
                    if (availableBottom <= availableTop) {
                        onComplete.accept(new Rect());
                        return;
                    }
                    final int top = availableTop;
                    final int bottom = availableBottom;
                    final Rect availableRect = new Rect(
                            requestRect.left,
                            (int) Math.round(availableTop - current.startPx),
                            requestRect.right,
                            (int) Math.round(availableBottom - current.startPx)
                    );
                    requestFrame(() -> captureAndRender(current, token, top, bottom, actualPx, availableRect, onComplete));
                }
        );
    }

    private void captureAndRender(
            Session current,
            long token,
            int availableTop,
            int availableBottom,
            int scrollPx,
            Rect availableRect,
            Consumer<Rect> onComplete
    ) {
        if (token != sessionToken || current.renderer == null) {
            return;
        }
        Window window = activity == null ? null : activity.getWindow();
        if (window == null || current.shot == null) {
            onComplete.accept(new Rect());
            return;
        }
        Rect source = new Rect(
                current.position.x + current.bounds.left,
                current.position.y + current.bounds.top,
                current.position.x + current.bounds.right,
                current.position.y + current.bounds.bottom
        );
        PixelCopy.request(window, source, current.shot, result -> {
            if (token != sessionToken || current.renderer == null) {
                return;
            }
            if (result != PixelCopy.SUCCESS) {
                Log.d(TAG, "pixelcopy failed: " + result);
                onComplete.accept(new Rect());
                return;
            }
            int srcTop = availableTop - scrollPx;
            int height = availableBottom - availableTop;
            int width = current.bounds.width();
            if (srcTop < 0 || srcTop + height > current.shot.getHeight() || height <= 0) {
                onComplete.accept(new Rect());
                return;
            }
            int drawResult = renderToSurface(
                    current,
                    new Rect(0, srcTop, width, srcTop + height),
                    new Rect(0, 0, width, height)
            );
            if (drawResult != 0 && drawResult != 1) {
                Log.d(TAG, "render failed: " + drawResult);
                onComplete.accept(new Rect());
                return;
            }
            Log.d(TAG, "captured " + availableRect);
            onComplete.accept(availableRect);
        }, handler);
    }

    /** 把截图裁片通过 GPU 画进系统给的 Surface（ImageReader 只支持 GPU 写入）。 */
    private int renderToSurface(Session current, Rect src, Rect dst) {
        current.node.setPosition(0, 0, dst.width(), dst.height());
        RecordingCanvas canvas = current.node.beginRecording();
        canvas.drawBitmap(current.shot, src, dst, paint);
        current.node.endRecording();
        HardwareRenderer.FrameRenderRequest request = current.renderer.createRenderRequest();
        request.setVsyncTime(System.nanoTime());
        return request.syncAndDraw();
    }

    @Override
    public void onScrollCaptureEnd(Runnable onReady) {
        releaseSession();
        onReady.run();
    }

    private void releaseSession() {
        sessionToken++;
        Session current = session;
        session = null;
        if (current == null) {
            return;
        }
        if (current.renderer != null) {
            current.renderer.destroy();
            current.renderer = null;
        }
        if (current.shot != null) {
            current.shot.recycle();
            current.shot = null;
        }
        webView.evaluateJavascript(JS_RESTORE, null);
    }

    /** 等 WebView 提交新画面后再截图；callback 不回调时靠超时兜底。 */
    private void requestFrame(Runnable action) {
        final boolean[] consumed = {false};
        Runnable run = () -> {
            if (consumed[0]) {
                return;
            }
            consumed[0] = true;
            action.run();
        };
        try {
            webView.postVisualStateCallback(
                    System.nanoTime(),
                    new WebView.VisualStateCallback() {
                        @Override
                        public void onComplete(long requestId) {
                            handler.postDelayed(run, FRAME_DELAY);
                        }
                    }
            );
        } catch (Throwable error) {
            Log.d(TAG, "visual state callback unavailable: " + error);
        }
        handler.postDelayed(run, FRAME_TIMEOUT);
    }

    private Rect elementBounds(JSONObject metrics, float dpr) {
        int left = Math.round((float) metrics.optDouble("left", 0.0) * dpr);
        int top = Math.round((float) metrics.optDouble("top", 0.0) * dpr);
        int right = Math.round((float) (metrics.optDouble("left", 0.0)
                + metrics.optDouble("width", 0.0)) * dpr);
        int bottom = Math.round((float) (metrics.optDouble("top", 0.0)
                + metrics.optDouble("height", 0.0)) * dpr);
        left = Math.max(0, left);
        top = Math.max(0, top);
        right = Math.min(webView.getWidth(), right);
        bottom = Math.min(webView.getHeight(), bottom);
        return new Rect(left, top, right, bottom);
    }

    private static float dprOf(JSONObject metrics) {
        float dpr = (float) metrics.optDouble("dpr", 1.0);
        return dpr > 0f ? dpr : 1f;
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

    private static double parseNumber(String raw) {
        if (raw == null) {
            return Double.NaN;
        }
        String text = raw.trim();
        if (text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
            text = text.substring(1, text.length() - 1);
        }
        try {
            return Double.parseDouble(text);
        } catch (NumberFormatException error) {
            return Double.NaN;
        }
    }
}
