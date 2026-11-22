import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Modal,
  ActivityIndicator,
  Alert
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_SERVER_URL = 'http://192.168.1.4:4000';
const STORAGE_KEY = '@attendance_backend_url';

export default function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const webViewRef = useRef(null);

  useEffect(() => {
    loadSavedServerUrl();
  }, []);

  const loadSavedServerUrl = async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      const urlToUse = saved || DEFAULT_SERVER_URL;
      setServerUrl(urlToUse);
      setInputUrl(urlToUse);
    } catch (e) {
      setServerUrl(DEFAULT_SERVER_URL);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveUrl = async () => {
    if (!inputUrl.trim()) {
      Alert.alert('Invalid URL', 'Please enter a valid server URL');
      return;
    }
    const cleanUrl = inputUrl.trim().replace(/\/+$/, '');
    try {
      await AsyncStorage.setItem(STORAGE_KEY, cleanUrl);
      setServerUrl(cleanUrl);
      setIsConfigOpen(false);
      if (webViewRef.current) {
        webViewRef.current.reload();
      }
      Alert.alert('Saved', `Connected to: ${cleanUrl}`);
    } catch (e) {
      Alert.alert('Error', 'Failed to save URL');
    }
  };

  const handleResetUrl = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setInputUrl(DEFAULT_SERVER_URL);
    setServerUrl(DEFAULT_SERVER_URL);
    setIsConfigOpen(false);
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
  };

  if (isLoading || !serverUrl) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#10b981" />
        <Text style={styles.loadingText}>Initializing Apex Attendance...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Native App Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.statusDot} />
          <Text style={styles.title}>Apex Attendance Kiosk</Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => webViewRef.current?.reload()}
          >
            <Text style={styles.headerBtnText}>🔄 Reload</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.headerBtn, styles.gearBtn]}
            onPress={() => setIsConfigOpen(true)}
          >
            <Text style={styles.gearText}>⚙️ Server</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Core Attendance Interface with Native Camera Access */}
      <WebView
        ref={webViewRef}
        source={{ uri: serverUrl }}
        style={styles.webview}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        originWhitelist={['*']}
        androidCameraPermissionOptions={{
          title: 'Permission to use camera',
          message: 'Apex Attendance requires camera access to scan faces',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }}
        renderError={(errorName) => (
          <View style={styles.centerContainer}>
            <Text style={styles.errorTitle}>Connection Failed</Text>
            <Text style={styles.errorSub}>
              Unable to reach: {serverUrl}
            </Text>
            <Text style={styles.errorHint}>
              Ensure your coaching PC is running or configure your Cloudflare / Ngrok URL in Settings.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setIsConfigOpen(true)}
            >
              <Text style={styles.primaryButtonText}>Change Server URL</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Server Configuration Modal */}
      <Modal
        visible={isConfigOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsConfigOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Backend Server Setup</Text>
            <Text style={styles.modalDesc}>
              Link this mobile app to your coaching PC server (or your GitHub Pages tunnel):
            </Text>

            <TextInput
              style={styles.input}
              value={inputUrl}
              onChangeText={setInputUrl}
              placeholder="e.g. https://apex.trycloudflare.com or http://192.168.1.4:4000"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn]}
                onPress={handleSaveUrl}
              >
                <Text style={styles.saveBtnText}>Save & Connect</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.resetBtn]}
                onPress={handleResetUrl}
              >
                <Text style={styles.resetBtnText}>Reset</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setIsConfigOpen(false)}
              >
                <Text style={styles.cancelBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  webview: {
    flex: 1,
    backgroundColor: '#020617',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 8,
  },
  title: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    marginLeft: 6,
  },
  gearBtn: {
    backgroundColor: '#059669',
  },
  headerBtnText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  gearText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#020617',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 14,
  },
  errorTitle: {
    color: '#f43f5e',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorSub: {
    color: '#cbd5e1',
    fontSize: 13,
    marginBottom: 6,
  },
  errorHint: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
  },
  modalDesc: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 16,
    lineHeight: 16,
  },
  input: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtn: {
    backgroundColor: '#10b981',
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  resetBtn: {
    backgroundColor: '#334155',
  },
  resetBtnText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 12,
  },
  cancelBtn: {
    backgroundColor: '#1e293b',
  },
  cancelBtnText: {
    color: '#94a3b8',
    fontSize: 12,
  },
});
