package com.apex.attendance;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
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

        // 1. Check if we already have a saved server URL
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String savedUrl = prefs.getString(KEY_SERVER_URL, null);

        if (savedUrl != null && !savedUrl.isEmpty()) {
            webView.loadUrl(savedUrl);
        } else {
            // 2. Zero-Config: Auto-discover the main coaching PC on the local Wi-Fi
            discoverServerOnLocalWifi();
        }
    }

    /**
     * Automatic Zero-Config Wi-Fi Broadcast Discovery
     */
    private void discoverServerOnLocalWifi() {
        Toast.makeText(this, "Detecting Coaching PC on Wi-Fi...", Toast.LENGTH_SHORT).show();

        new Thread(() -> {
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                socket.setBroadcast(true);
                socket.setSoTimeout(4000); // Wait up to 4s for PC beacon

                String probeMessage = "DISCOVER_APEX_ATTENDANCE_SERVER";
                byte[] sendData = probeMessage.getBytes();

                // Broadcast packet to local subnet
                DatagramPacket sendPacket = new DatagramPacket(
                        sendData,
                        sendData.length,
                        InetAddress.getByName("255.255.255.255"),
                        DISCOVERY_PORT
                );
                socket.send(sendPacket);
                Log.d(TAG, "Broadcast probe sent to 255.255.255.255:" + DISCOVERY_PORT);

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
                Log.w(TAG, "Auto-discovery timeout, falling back to default or reverse", e);
                mainHandler.post(() -> {
                    // Fallback to localhost or prompt
                    webView.loadUrl(DEFAULT_URL);
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
                // If failed, trigger auto-discovery again or show prompt
                if (!isServerDiscovered) {
                    discoverServerOnLocalWifi();
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
        builder.setMessage(message != null ? message : "Enter Coaching Server URL:");

        final EditText input = new EditText(this);
        input.setText(currentUrl);
        builder.setView(input);

        builder.setPositiveButton("Connect", (dialog, which) -> {
            String newUrl = input.getText().toString().trim();
            if (!newUrl.isEmpty()) {
                prefs.edit().putString(KEY_SERVER_URL, newUrl).apply();
                webView.loadUrl(newUrl);
            }
        });

        builder.setNegativeButton("Re-Scan Wi-Fi", (dialog, which) -> discoverServerOnLocalWifi());
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
