// Production environment (committed, NO secrets). Inject keys at deploy time (e.g. from CI secrets).
export const environment = {
  production: true,
  useMocks: false,
  apiBaseUrl: 'http://localhost:8000/api/v1',
  wsUrl: 'ws://localhost:8000/ws/live',
  ingestApiKey: '',
  opsMocks: true,
  primeLicense: '',
};
