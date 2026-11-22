package com.apex.attendance;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.wifi.WifiInfo;
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
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "ApexAttendance";
    private static final int CAMERA_PERMISSION_CODE = 101;
    private static final String PREFS_NAME = "AttendancePrefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String DEFAULT_URL = "http://localhost:4000";
    private static final int DISCOVERY_PORT = 41234;

    private WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean isServerDiscovered = false;

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

        // Always attempt auto-discovery to adapt to dynamic Wi-Fi IP changes seamlessly
        discoverServerOnLocalWifi(savedUrl);
    }

    /**
     * Automatic Zero-Config Wi-Fi Broadcast Discovery with subnet sweep
     */
    private void discoverServerOnLocalWifi(String fallbackUrl) {
        Toast.makeText(this, "Detecting Coaching PC on Wi-Fi...", Toast.LENGTH_SHORT).show();

        new Thread(() -> {
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                socket.setBroadcast(true);
                socket.setSoTimeout(3500); // 3.5s timeout for fast response

                String probeMessage = "DISCOVER_APEX_ATTENDANCE_SERVER";
                byte[] sendData = probeMessage.getBytes();

                // 1. Send broadcast to 255.255.255.255
                DatagramPacket sendPacket = new DatagramPacket(
                        sendData,
                        sendData.length,
                        InetAddress.getByName("255.255.255.255"),
                        DISCOVERY_PORT
                );
                socket.send(sendPacket);

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

                Log.d(TAG, "Broadcast probes sent on UDP:" + DISCOVERY_PORT);

                // Receive response from main PC
                byte[] recvBuf = new byte[1024];
                DatagramPacket receivePacket = new DatagramPacket(recvBuf, recvBuf.length);
                socket.receive(receivePacket);

                String hostIp = receivePacket.getAddress().getHostAddress();
                String discoveredUrl = "http://" + hostIp + ":4000";
                Log.i(TAG, "Server Auto-Discovered: " + discoveredUrl);

                isServerDiscovered = true;

                // Save auto-discovered URL
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(KEY_SERVER_URL, discoveredUrl).apply();

                mainHandler.post(() -> {
                    Toast.makeText(MainActivity.this, "Connected to Coaching PC: " + hostIp, Toast.LENGTH_SHORT).show();
                    webView.loadUrl(discoveredUrl);
                });

            } catch (Exception e) {
                Log.w(TAG, "Auto-discovery timeout, using fallback", e);
                mainHandler.post(() -> {
                    if (fallbackUrl != null && !fallbackUrl.isEmpty()) {
                        webView.loadUrl(fallbackUrl);
                    } else {
                        webView.loadUrl(DEFAULT_URL);
                    }
                });
            } finally {
                if (socket != null && !socket.isClosed()) {
                    socket.close();
                }
            }
        }).start();
    }

    private void setupWebView() {
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!isServerDiscovered) {
                    discoverServerOnLocalWifi(null);
                } else {
                    showConfigDialog("Could not connect to " + failingUrl);
                }
            }
        });
    }

    public void showConfigDialog(String message) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String currentUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_URL);

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Server Configuration");
        builder.setMessage(message != null ? message : "Enter Coaching PC IP Address or URL:");

        final EditText input = new EditText(this);
        input.setHint("e.g. http://192.168.1.5:4000");
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

        builder.setNegativeButton("Re-Scan Wi-Fi", (dialog, which) -> discoverServerOnLocalWifi(null));
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
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
