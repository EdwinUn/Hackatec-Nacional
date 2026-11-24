// Template. Copy to `environment.development.ts` (git-ignored) and fill in your own values:
//   cp src/environments/environment.example.ts src/environments/environment.development.ts
export const environment = {
  production: false,
  /** true: in-memory mock backend + simulated live stream (also enabled with `?mock=1`). */
  useMocks: false,
  apiBaseUrl: 'http://localhost:8000/api/v1',
  wsUrl: 'ws://localhost:8000/ws/live',
  /** Sent as `X-API-Key` on the simulation / ingest POST endpoints (dev key goes in environment.development.ts). */
  ingestApiKey: '',
  /** PrimeNG / PrimeUI license key (community tier is free): https://primeui.store */
  primeLicense: '',
};
