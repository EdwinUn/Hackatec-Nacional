// Template. Copy to `environment.development.ts` (git-ignored) and fill in your own values:
//   cp src/environments/environment.example.ts src/environments/environment.development.ts
export const environment = {
  production: false,
  /** true: in-memory mock backend + simulated live stream (also enabled with `?mock=1`). */
  useMocks: false,
  apiBaseUrl: 'http://localhost:8000/api/v1',
  wsUrl: 'ws://localhost:8000/ws/live',
  /** Sent as `X-API-Key` on the simulation / ingest POST endpoints (dev key goes in environment.development.ts). */
  ingestApiKey: '', // dev: 'dev-ingest-key' (= INGEST_API_KEY de backend/.env)
  /** true: login, citizen reports and work orders come from the local mock (backend endpoints still proposed). */
  opsMocks: true,
  /** PrimeNG / PrimeUI license key (community tier is free): https://primeui.store */
  primeLicense: 'eyJpZCI6ImQzZWQ3ZmRjLTg0ZjUtNGU2NC04OGVhLWY0ZTEwZmY2MjFkYSIsInByb2R1Y3QiOiJwcmltZXVpIiwidGllciI6ImNvbW11bml0eSIsInR5cGUiOiJkZXYiLCJpYXQiOjE3OTU0Nzk2MDIsImV4cCI6MTgyNzAxNTYwMn0.Tm2-t7jMGNVFQErVTm2-vF7sJSdJbezolUBbIVe0bj3aro0x2uyd6OHPvqwYse1NFgbJrbjn5nPT5pb3GRvWCQ',
};
