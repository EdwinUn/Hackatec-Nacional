// Base environment (committed, NO secrets). Development builds swap it for
// `environment.development.ts` (git-ignored); see angular.json fileReplacements.
export const environment = {
  production: false,
  useMocks: false,
  apiBaseUrl: 'http://localhost:8000/api/v1',
  wsUrl: 'ws://localhost:8000/ws/live',
  ingestApiKey: '',
  primeLicense: '',
};
