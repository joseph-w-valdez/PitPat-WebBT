package com.pitpat.webbt;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

public class MainActivity extends Activity {
    private static final UUID PITPAT_SERVICE = UUID.fromString("0000fba0-0000-1000-8000-00805f9b34fb");
    private static final UUID NOTIFY_CHARACTERISTIC = UUID.fromString("0000fba2-0000-1000-8000-00805f9b34fb");
    private static final UUID WRITE_CHARACTERISTIC = UUID.fromString("0000fba1-0000-1000-8000-00805f9b34fb");
    private static final UUID CLIENT_CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final int SCAN_REQUEST = 1;
    private static final int NOTIF_REQUEST = 2;
    private static final int MTU = 185;
    private static final long SCAN_MS = 10000;
    private static final long[] RECONNECT_DELAYS = {3000, 8000, 15000, 30000};

    private WebView webView;
    private BluetoothLeScanner scanner;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeCharacteristic;
    private byte[] pendingWrite;
    private boolean writeInFlight;
    private final Object writeLock = new Object();
    private boolean scanning;
    private boolean pageReady;
    private String pendingConnectAddress;
    private String pendingWidgetAction;
    private String pendingStatsMonth;
    private boolean autoConnectScan;
    private boolean userDisconnect;
    private boolean walkHeld;
    private boolean connecting;
    private boolean reconnectGaveUp;
    private int reconnectAttempt;
    private String noticeSpeed = "";
    private String noticeMiles = "0.00 mi today";
    private boolean noticeRunning;
    private boolean noticePaused;
    private boolean askedNotification;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable reconnectTask = this::attemptReconnect;
    private static MainActivity instance;

    static boolean runInBackground(String action) {
        MainActivity activity = instance;
        if (activity == null || action == null || action.isEmpty()) return false;
        activity.handler.post(() -> activity.runWidgetAction(action));
        return true;
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            String name = null;
            if (result.getScanRecord() != null) {
                name = result.getScanRecord().getDeviceName();
            }
            if (name == null || name.isEmpty()) {
                name = result.getDevice().getAddress();
            }
            String address = result.getDevice().getAddress();
            if (!autoConnectScan) {
                reportResult(name, address);
                return;
            }
            autoConnectScan = false;
            String label = name;
            handler.post(() -> {
                PitPatWidgetProvider.saveAddress(MainActivity.this, address);
                reportStatus("Connecting to " + label + "…");
                beginConnect(address);
            });
        }

        @Override
        public void onScanFailed(int errorCode) {
            reportStatus("Scan failed (" + errorCode + ")");
            scanning = false;
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (gatt != MainActivity.this.gatt) return;
            if (newState == BluetoothGatt.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                reportStatus("Connecting…");
                gatt.discoverServices();
                return;
            }
            if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                connecting = false;
                closeGatt();
                onLinkLost();
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                reportStatus("Could not read pad services");
                return;
            }
            gatt.requestMtu(MTU);
        }

        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS || mtu < 34) {
                reportStatus("Bluetooth packet size is too small");
                return;
            }
            enableNotifications(gatt);
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                reportStatus("Could not listen to the pad");
                return;
            }
            connecting = false;
            reconnectAttempt = 0;
            reconnectGaveUp = false;
            userDisconnect = false;
            handler.removeCallbacks(reconnectTask);
            runJs("window.onAndroidConnected()");
            reportStatus("Connected");
            refreshWalkNotice();
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            synchronized (writeLock) {
                writeInFlight = false;
            }
            if (status == BluetoothGatt.GATT_SUCCESS) {
                runJs("window.onAndroidWriteDone()");
            } else {
                runJs("window.onAndroidWriteFailed()");
            }
            handler.post(MainActivity.this::drainWrites);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            deliverNotification(value);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (Build.VERSION.SDK_INT < 33) {
                deliverNotification(characteristic.getValue());
            }
        }
    };

    private final Runnable stopScanTask = () -> stopScan(true);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                deliverWidgetAction();
                deliverStatsMonth();
            }
        });
        webView.addJavascriptInterface(new AndroidBridge(), "PitPatAndroid");
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        noteWidgetIntent(getIntent());
        noteStatsIntent(getIntent());
        if (shouldStayInBackground(getIntent())) {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        noteWidgetIntent(intent);
        noteStatsIntent(intent);
        if (shouldStayInBackground(intent)) {
            moveTaskToBack(true);
        } else {
            deliverWidgetAction();
            deliverStatsMonth();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (shouldStayInBackground(getIntent())) {
            getIntent().removeExtra(PitPatWidgetProvider.EXTRA_BACKGROUND);
            moveTaskToBack(true);
        }
        deliverWidgetAction();
        deliverStatsMonth();
    }

    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    private void noteWidgetIntent(Intent intent) {
        if (intent == null || !intent.hasExtra(PitPatWidgetProvider.EXTRA_WIDGET_ACTION)) return;
        pendingWidgetAction = intent.getStringExtra(PitPatWidgetProvider.EXTRA_WIDGET_ACTION);
        intent.removeExtra(PitPatWidgetProvider.EXTRA_WIDGET_ACTION);
    }

    private boolean shouldStayInBackground(Intent intent) {
        return intent != null && intent.getBooleanExtra(PitPatWidgetProvider.EXTRA_BACKGROUND, false);
    }

    private void runWidgetAction(String action) {
        pendingWidgetAction = action;
        deliverWidgetAction();
    }

    private void deliverWidgetAction() {
        if (!pageReady || webView == null || pendingWidgetAction == null || pendingWidgetAction.isEmpty()) return;
        String action = pendingWidgetAction;
        pendingWidgetAction = null;
        webView.evaluateJavascript("window.applyWidgetAction(" + JSONObject.quote(action) + ")", null);
    }

    private void noteStatsIntent(Intent intent) {
        if (intent == null || !intent.hasExtra(PitPatStatsWidgetProvider.EXTRA_MONTH)) return;
        pendingStatsMonth = intent.getStringExtra(PitPatStatsWidgetProvider.EXTRA_MONTH);
        intent.removeExtra(PitPatStatsWidgetProvider.EXTRA_MONTH);
    }

    private void deliverStatsMonth() {
        if (!pageReady || webView == null || pendingStatsMonth == null || pendingStatsMonth.isEmpty()) return;
        String month = pendingStatsMonth;
        pendingStatsMonth = null;
        webView.evaluateJavascript("window.showStatsMonth(" + JSONObject.quote(month) + ")", null);
    }

    @Override
    protected void onPause() {
        super.onPause();
        stopScan(false);
    }

    @Override
    protected void onDestroy() {
        if (instance == this) instance = null;
        handler.removeCallbacks(reconnectTask);
        stopScan(false);
        closeGatt();
        WalkService.stop(this);
        PitPatWidgetProvider.publish(this, false, false, "Disconnected");
        super.onDestroy();
    }

    private void ensurePermissionAndScan() {
        pendingConnectAddress = null;
        if (!ensureBluetoothPermissions()) return;
        beginScan();
    }

    private void ensurePermissionAndConnect(String address) {
        pendingConnectAddress = address;
        if (!ensureBluetoothPermissions()) return;
        pendingConnectAddress = null;
        beginConnect(address);
    }

    private boolean ensureBluetoothPermissions() {
        List<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.BLUETOOTH_SCAN);
            }
            if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.BLUETOOTH_CONNECT);
            }
        } else if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            needed.add(android.Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (needed.isEmpty()) return true;
        requestPermissions(needed.toArray(new String[0]), SCAN_REQUEST);
        return false;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != SCAN_REQUEST) return;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                reportStatus("Bluetooth permission denied");
                pendingConnectAddress = null;
                return;
            }
        }
        if (grantResults.length == 0) return;
        if (pendingConnectAddress != null) {
            String address = pendingConnectAddress;
            pendingConnectAddress = null;
            beginConnect(address);
        } else {
            beginScan();
        }
    }

    @SuppressLint("MissingPermission")
    private void beginScan() {
        BluetoothAdapter adapter = bluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            reportStatus("Bluetooth is off");
            return;
        }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            reportStatus("Bluetooth scan is unavailable");
            return;
        }
        if (scanning) stopScan(false);
        scanning = true;
        ScanFilter filter = new ScanFilter.Builder()
                .setServiceUuid(new ParcelUuid(PITPAT_SERVICE))
                .build();
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
        scanner.startScan(Collections.singletonList(filter), settings, scanCallback);
        reportStatus("Scanning…");
        handler.postDelayed(stopScanTask, SCAN_MS);
    }

    @SuppressLint("MissingPermission")
    private void stopScan(boolean announce) {
        handler.removeCallbacks(stopScanTask);
        if (!scanning || scanner == null) return;
        scanning = false;
        scanner.stopScan(scanCallback);
        if (!announce) return;
        if (autoConnectScan) {
            autoConnectScan = false;
            reportStatus("Pad not found");
            if (walkHeld) giveUpReconnect();
            return;
        }
        reportStatus("Scan finished");
    }

    @SuppressLint("MissingPermission")
    private void beginConnect(String address) {
        stopScan(false);
        closeGatt();
        BluetoothAdapter adapter = bluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            reportStatus("Bluetooth is off");
            if (walkHeld) giveUpReconnect();
            return;
        }
        BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(address);
        } catch (IllegalArgumentException err) {
            reportStatus("That pad address is not valid");
            return;
        }
        connecting = true;
        reportStatus("Connecting…");
        gatt = device.connectGatt(this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        refreshWalkNotice();
    }

    private void onLinkLost() {
        runJs("window.onAndroidDisconnected()");
        reportStatus("Disconnected");
        if (userDisconnect || !walkHeld || reconnectGaveUp) return;
        if (reconnectAttempt >= RECONNECT_DELAYS.length) {
            giveUpReconnect();
            return;
        }
        long delay = RECONNECT_DELAYS[reconnectAttempt];
        reconnectAttempt += 1;
        handler.removeCallbacks(reconnectTask);
        handler.postDelayed(reconnectTask, delay);
        refreshWalkNotice();
    }

    private void attemptReconnect() {
        if (!walkHeld || userDisconnect || reconnectGaveUp) return;
        String address = PitPatWidgetProvider.lastAddress(this);
        if (address == null || address.isEmpty()) {
            giveUpReconnect();
            return;
        }
        beginConnect(address);
    }

    private void giveUpReconnect() {
        reconnectGaveUp = true;
        reconnectAttempt = 0;
        handler.removeCallbacks(reconnectTask);
        connecting = false;
        WalkService.stop(this);
    }

    private void refreshWalkNotice() {
        if (!walkHeld || userDisconnect || reconnectGaveUp) {
            WalkService.stop(this);
            return;
        }
        if (gatt == null && !connecting) return;
        String title;
        String action = "";
        if (gatt == null) title = "Reconnecting";
        else if (noticeRunning) {
            title = noticeSpeed.isEmpty() ? "Walking" : noticeSpeed;
            action = "pause";
        } else if (noticePaused) {
            title = "Paused";
            action = "resume";
        } else title = "Walking";
        WalkService.show(this, title, noticeMiles, action);
    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33 || askedNotification) return;
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        askedNotification = true;
        requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, NOTIF_REQUEST);
    }

    @SuppressLint("MissingPermission")
    private void enableNotifications(BluetoothGatt gatt) {
        BluetoothGattService service = gatt.getService(PITPAT_SERVICE);
        if (service == null) {
            reportStatus("PitPat service not found");
            return;
        }
        BluetoothGattCharacteristic notify = service.getCharacteristic(NOTIFY_CHARACTERISTIC);
        if (notify == null) {
            reportStatus("PitPat notify characteristic not found");
            return;
        }
        writeCharacteristic = service.getCharacteristic(WRITE_CHARACTERISTIC);
        if (writeCharacteristic == null) {
            reportStatus("PitPat write characteristic not found");
            return;
        }
        BluetoothGattDescriptor descriptor = notify.getDescriptor(CLIENT_CONFIG);
        if (descriptor == null) {
            reportStatus("PitPat notify switch not found");
            return;
        }
        gatt.setCharacteristicNotification(notify, true);
        if (Build.VERSION.SDK_INT >= 33) {
            gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
        } else {
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(descriptor);
        }
    }

    private void enqueueWrite(byte[] data) {
        synchronized (writeLock) {
            pendingWrite = data;
        }
        handler.post(this::drainWrites);
    }

    @SuppressLint("MissingPermission")
    private void drainWrites() {
        byte[] data;
        BluetoothGatt current;
        BluetoothGattCharacteristic characteristic;
        synchronized (writeLock) {
            if (writeInFlight || pendingWrite == null || gatt == null || writeCharacteristic == null) return;
            data = pendingWrite;
            pendingWrite = null;
            writeInFlight = true;
            current = gatt;
            characteristic = writeCharacteristic;
        }
        boolean started;
        if (Build.VERSION.SDK_INT >= 33) {
            int result = current.writeCharacteristic(characteristic, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            started = result == BluetoothStatusCodes.SUCCESS;
        } else {
            characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            characteristic.setValue(data);
            started = current.writeCharacteristic(characteristic);
        }
        if (!started) {
            synchronized (writeLock) {
                writeInFlight = false;
            }
            runJs("window.onAndroidWriteFailed()");
        }
    }

    @SuppressLint("MissingPermission")
    private void closeGatt() {
        synchronized (writeLock) {
            pendingWrite = null;
            writeInFlight = false;
            writeCharacteristic = null;
        }
        if (gatt == null) return;
        BluetoothGatt current = gatt;
        gatt = null;
        current.disconnect();
        current.close();
    }

    private void disconnectPad() {
        userDisconnect = true;
        handler.removeCallbacks(reconnectTask);
        boolean wasConnected = gatt != null;
        closeGatt();
        connecting = false;
        WalkService.stop(this);
        if (wasConnected) {
            runJs("window.onAndroidDisconnected()");
            reportStatus("Disconnected");
        }
    }

    private BluetoothAdapter bluetoothAdapter() {
        BluetoothManager manager = getSystemService(BluetoothManager.class);
        return manager == null ? null : manager.getAdapter();
    }

    private void deliverNotification(byte[] value) {
        if (value == null) return;
        StringBuilder js = new StringBuilder("window.onAndroidNotification([");
        for (int i = 0; i < value.length; i++) {
            if (i > 0) js.append(',');
            js.append(value[i] & 0xff);
        }
        js.append("])");
        runJs(js.toString());
    }

    private void reportResult(String name, String address) {
        String js = "window.showAndroidScanResult(" + JSONObject.quote(name) + "," + JSONObject.quote(address) + ")";
        runJs(js);
    }

    private void reportStatus(String message) {
        runJs("window.showAndroidScanStatus(" + JSONObject.quote(message) + ")");
    }

    private void runJs(String script) {
        handler.post(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void startScan() {
            handler.post(MainActivity.this::ensurePermissionAndScan);
        }

        @JavascriptInterface
        public void connect(String address) {
            handler.post(() -> {
                userDisconnect = false;
                reconnectGaveUp = false;
                reconnectAttempt = 0;
                PitPatWidgetProvider.saveAddress(MainActivity.this, address);
                ensurePermissionAndConnect(address);
            });
        }

        @JavascriptInterface
        public void connectLast() {
            handler.post(() -> {
                userDisconnect = false;
                reconnectGaveUp = false;
                reconnectAttempt = 0;
                String address = PitPatWidgetProvider.lastAddress(MainActivity.this);
                if (address == null || address.isEmpty()) {
                    autoConnectScan = true;
                    ensurePermissionAndScan();
                } else {
                    autoConnectScan = false;
                    ensurePermissionAndConnect(address);
                }
            });
        }

        @JavascriptInterface
        public String rollPetCat(boolean forceNew) {
            String cat = PitPatPetWidgetProvider.rollCat(MainActivity.this, forceNew);
            handler.post(() -> PitPatPetWidgetProvider.refresh(MainActivity.this));
            return cat;
        }

        @JavascriptInterface
        public void shakePet() {
            handler.post(() -> PitPatPetWidgetProvider.shake(MainActivity.this));
        }

        @JavascriptInterface
        public void setWalkNotice(boolean held, boolean running, boolean paused, String speed, String miles) {
            handler.post(() -> {
                walkHeld = held;
                noticeRunning = running;
                noticePaused = paused;
                noticeSpeed = speed == null ? "" : speed;
                noticeMiles = miles == null || miles.isEmpty() ? "0.00 mi today" : miles;
                if (!held) {
                    userDisconnect = false;
                    reconnectGaveUp = false;
                    reconnectAttempt = 0;
                    handler.removeCallbacks(reconnectTask);
                } else {
                    ensureNotificationPermission();
                }
                refreshWalkNotice();
            });
        }

        @JavascriptInterface
        public void setWidgetState(boolean connected, boolean running, String status, String speed, String time, String calories, String distance, String preset, int goal) {
            handler.post(() -> {
                PitPatWidgetProvider.publish(MainActivity.this, connected, running, status, speed, time, calories, distance, preset, goal);
                PitPatPetWidgetProvider.refresh(MainActivity.this);
            });
        }

        @JavascriptInterface
        public void setStatsSnapshot(String json) {
            handler.post(() -> PitPatStatsWidgetProvider.saveSnapshot(MainActivity.this, json));
        }

        @JavascriptInterface
        public void disconnect() {
            handler.post(MainActivity.this::disconnectPad);
        }

        @JavascriptInterface
        public void writeHex(String hex) {
            if (hex == null || hex.isEmpty()) return;
            String[] parts = hex.trim().split("\\s+");
            byte[] data = new byte[parts.length];
            for (int i = 0; i < parts.length; i++) {
                data[i] = (byte) Integer.parseInt(parts[i], 16);
            }
            enqueueWrite(data);
        }
    }
}
