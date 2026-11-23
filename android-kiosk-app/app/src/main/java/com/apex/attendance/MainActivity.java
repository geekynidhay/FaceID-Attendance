package com.apex.attendance;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.DhcpInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "ApexAttendance";
    private static final int CAMERA_PERMISSION_CODE = 101;
    private static final String PREFS_NAME = "AttendancePrefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final int DISCOVERY_PORT = 41234;

    private WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean isServerDiscovered = false;
    private WifiManager.MulticastLock multicastLock;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_CODE);
        }

        setupWebView();

        // Check if we have a saved server URL
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String savedUrl = prefs.getString(KEY_SERVER_URL, null);

        // Acquire MulticastLock so Android doesn't filter broadcast packets
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                multicastLock = wifi.createMulticastLock("dotcmc_multicast_lock");
                multicastLock.setReferenceCounted(true);
                multicastLock.acquire();
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not acquire MulticastLock", e);
        }

        // Test saved URL or auto-discover coaching PC
        if (savedUrl != null && !savedUrl.isEmpty() && !savedUrl.contains("localhost")) {
            testAndLoadUrl(savedUrl);
        } else {
            discoverServerOnLocalWifi();
        }
    }

    private void testAndLoadUrl(String urlToCheck) {
        new Thread(() -> {
            boolean reachable = isServerResponding(urlToCheck);
            if (reachable) {
                mainHandler.post(() -> webView.loadUrl(urlToCheck));
            } else {
                discoverServerOnLocalWifi();
            }
        }).start();
    }

    private boolean isServerResponding(String targetUrl) {
        try {
            URL url = new URL(targetUrl + "/api/whatsapp/status");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(1500);
            conn.setReadTimeout(1500);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            return (code == 200);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Automatic Zero-Config Wi-Fi Broadcast Discovery + Fast Subnet Ping Scan
     */
    private void discoverServerOnLocalWifi() {
        mainHandler.post(() -> Toast.makeText(this, "Detecting Coaching PC on Wi-Fi...", Toast.LENGTH_SHORT).show());

        new Thread(() -> {
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                socket.setBroadcast(true);
                socket.setSoTimeout(1500); // Wait 1.5s for UDP broadcast beacon

                String probeMessage = "DISCOVER_APEX_ATTENDANCE_SERVER";
                byte[] sendData = probeMessage.getBytes();

                // 1. Send broadcast to 255.255.255.255
                try {
                    DatagramPacket sendPacket = new DatagramPacket(
                            sendData,
                            sendData.length,
                            InetAddress.getByName("255.255.255.255"),
                            DISCOVERY_PORT
                    );
                    socket.send(sendPacket);
                } catch (Exception ignored) {}

                // 2. Also send broadcast to all active network interface broadcast addresses
                try {
                    Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
                    while (interfaces.hasMoreElements()) {
                        NetworkInterface networkInterface = interfaces.nextElement();
                        if (networkInterface.isLoopback() || !networkInterface.isUp()) continue;

                        for (InterfaceAddress interfaceAddress : networkInterface.getInterfaceAddresses()) {
                            InetAddress broadcast = interfaceAddress.getBroadcast();
                            if (broadcast != null) {
                                DatagramPacket ifPacket = new DatagramPacket(sendData, sendData.length, broadcast, DISCOVERY_PORT);
                                socket.send(ifPacket);
                            }
                        }
                    }
                } catch (Exception ignored) {}

                // Receive response from main PC
                byte[] recvBuf = new byte[1024];
                DatagramPacket receivePacket = new DatagramPacket(recvBuf, recvBuf.length);
                socket.receive(receivePacket);

                String hostIp = receivePacket.getAddress().getHostAddress();
                onServerFound(hostIp);
                return;

            } catch (Exception e) {
                Log.i(TAG, "UDP broadcast blocked by router, starting fast parallel HTTP subnet scan...");
            } finally {
                if (socket != null && !socket.isClosed()) {
                    socket.close();
                }
            }

            // Fallback: Ultra-fast parallel HTTP sweep across current Wi-Fi /24 subnet (1-254)
            scanLocalSubnetHttp();

        }).start();
    }

    /**
     * Parallel Subnet Scanner (Bypasses AP Isolation / UDP broadcast filtering on Wi-Fi routers)
     */
    private void scanLocalSubnetHttp() {
        String myIp = null;
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface iface = interfaces.nextElement();
                if (iface.isLoopback() || !iface.isUp()) continue;
                for (InterfaceAddress addr : iface.getInterfaceAddresses()) {
                    InetAddress inetAddr = addr.getAddress();
                    if (!inetAddr.isLoopbackAddress() && inetAddr.getAddress().length == 4) {
                        myIp = inetAddr.getHostAddress();
                        break;
                    }
                }
                if (myIp != null) break;
            }
        } catch (Exception ignored) {}

        if (myIp == null || !myIp.contains(".")) {
            mainHandler.post(() -> showConfigDialog("Could not auto-detect Coaching PC on Wi-Fi."));
            return;
        }

        String subnetPrefix = myIp.substring(0, myIp.lastIndexOf('.') + 1);
        ExecutorService pool = Executors.newFixedThreadPool(30);
        AtomicBoolean found = new AtomicBoolean(false);

        for (int i = 1; i <= 254; i++) {
            final String targetIp = subnetPrefix + i;
            pool.execute(() -> {
                if (found.get()) return;
                try {
                    URL testUrl = new URL("http://" + targetIp + ":4000/api/whatsapp/status");
                    HttpURLConnection conn = (HttpURLConnection) testUrl.openConnection();
                    conn.setConnectTimeout(800);
                    conn.setReadTimeout(800);
                    conn.setRequestMethod("GET");
                    if (conn.getResponseCode() == 200) {
                        java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                        StringBuilder sb = new StringBuilder();
                        String l;
                        while ((l = in.readLine()) != null) sb.append(l);
                        in.close();
                        if (sb.toString().contains("attendance-bot") || sb.toString().contains("DOT-CMC")) {
                            if (found.compareAndSet(false, true)) {
                                onServerFound(targetIp);
                            }
                        }
                    }
                } catch (Exception ignored) {}
            });
        }

        pool.shutdown();
        try {
            pool.awaitTermination(3, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {}

        if (!found.get()) {
            mainHandler.post(() -> showConfigDialog("Could not find Coaching PC on Wi-Fi network."));
        }
    }

    private void onServerFound(String hostIp) {
        String discoveredUrl = "https://" + hostIp + ":4443";
        Log.i(TAG, "Server Auto-Discovered: " + discoveredUrl);
        isServerDiscovered = true;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_SERVER_URL, discoveredUrl).apply();

        mainHandler.post(() -> {
            Toast.makeText(MainActivity.this, "Connected: " + hostIp, Toast.LENGTH_SHORT).show();
            webView.loadUrl(discoveredUrl);
        });
    }

    private void setupWebView() {
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Enable Chromium command-line flags to treat LAN HTTP origins as secure context for getUserMedia / WebRTC
        try {
            android.webkit.WebView.enableSlowWholeDocumentDraw();
        } catch (Exception ignored) {}

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] resources = request.getResources();
                    request.grant(resources);
                });
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                // Allow self-signed certificate for local institute intranet server
                handler.proceed();
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!failingUrl.contains("localhost")) {
                    showConfigDialog("Could not connect to " + failingUrl);
                }
            }
        });
    }

    public void showConfigDialog(String message) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String currentUrl = prefs.getString(KEY_SERVER_URL, "http://192.168.1.4:4000");

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Server Connection");
        builder.setMessage(message != null ? message : "Enter Coaching PC IP Address:");

        final EditText input = new EditText(this);
        input.setHint("e.g. 192.168.1.4 or http://192.168.1.4:4000");
        input.setText(currentUrl);
        builder.setView(input);

        builder.setPositiveButton("Connect", (dialog, which) -> {
            String newUrl = input.getText().toString().trim();
            if (!newUrl.isEmpty()) {
                if (!newUrl.startsWith("http://") && !newUrl.startsWith("https://")) {
                    newUrl = "http://" + newUrl;
                }
                if (!newUrl.matches(".*:\\d+$")) {
                    newUrl = newUrl + ":4000";
                }
                prefs.edit().putString(KEY_SERVER_URL, newUrl).apply();
                webView.loadUrl(newUrl);
            }
        });

        builder.setNegativeButton("Re-Scan Wi-Fi", (dialog, which) -> discoverServerOnLocalWifi());
        builder.setCancelable(false);
        builder.show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                webView.reload();
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (multicastLock != null && multicastLock.isHeld()) {
            multicastLock.release();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
