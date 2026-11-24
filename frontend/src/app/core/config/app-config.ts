import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface AppConfig {
  useMocks: boolean;
  apiBaseUrl: string;
  wsUrl: string;
  ingestApiKey: string;
  /** Operations module (login, citizen reports, work orders) from the local mock instead of the backend. */
  opsMocks: boolean;
}

/** `?mock=1` forces the in-memory backend (handy for demos when the API is down). */
function mockForced(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('mock') === '1';
  } catch {
    return false;
  }
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => ({
    useMocks: environment.useMocks || mockForced(),
    apiBaseUrl: environment.apiBaseUrl.replace(/\/$/, ''),
    wsUrl: environment.wsUrl,
    ingestApiKey: environment.ingestApiKey,
    opsMocks: environment.useMocks || mockForced() || (environment as { opsMocks?: boolean }).opsMocks !== false,
  }),
});
