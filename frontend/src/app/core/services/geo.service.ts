import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { GeoPoint } from '../models/ops.models';

/** Current position of the phone (Capacitor plugin on Android, browser API on the web). */
@Injectable({ providedIn: 'root' })
export class GeoService {
  async current(): Promise<GeoPoint> {
    try {
      if (Capacitor.isNativePlatform()) {
        const perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          const req = await Geolocation.requestPermissions({ permissions: ['location'] });
          if (req.location !== 'granted') throw new Error('denied');
        }
      }
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
      return { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).toLowerCase();
      if (msg.includes('denied') || msg.includes('permission')) throw new Error('Activa el permiso de ubicación para continuar.');
      if (msg.includes('timeout')) throw new Error('No se obtuvo la ubicación a tiempo. Intenta al aire libre.');
      throw new Error('No se pudo obtener la ubicación. Revisa que el GPS esté encendido.');
    }
  }
}
