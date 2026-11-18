package dev.xiyan.chat;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LongScreenshotPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
