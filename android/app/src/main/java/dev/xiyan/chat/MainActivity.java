package dev.xiyan.chat;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LongScreenshotPlugin.class);
        super.onCreate(savedInstanceState);
        installScrollCapture();
    }

    /** 让系统截图自带的「截长图」按钮支持 WebView 内部滚动（Android 14+）。 */
    private void installScrollCapture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return;
        }
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) {
            webView.setScrollCaptureCallback(new WebViewScrollCaptureCallback(this, webView));
        }
    }
}
