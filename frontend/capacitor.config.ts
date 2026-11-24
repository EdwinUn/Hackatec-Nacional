import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mx.tecnm.riomonitor',
  appName: 'Atl-Monitor',
  webDir: 'dist/ecosentinel/browser',
  server: {
    // The API runs over plain HTTP/WS on the LAN (hotspot): serve the app from http://localhost
    // and let the WebView call http:// and ws:// endpoints.
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
