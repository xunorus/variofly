# 📝 Audit Log — VarioDapp Development

Este archivo registra las acciones principales, comandos ejecutados y cambios realizados por el asistente de IA.

---

## [2026-04-12] 13:04 (Inicio de sesión)

### 🛠 Capacitor & Barometer Fix
- **Acción**: Actualización de dependencias y arreglo del Bridge de Capacitor.
- **Comandos**: 
  - `yarn install`
  - `yarn build`
  - `npx cap sync android`
- **Cambios**: 
  - Downgrade preventivo a **Capacitor 7** para compatibilidad con Node v20.
  - Ajuste de métodos API en `app.js` (`isAvailable`, `measurement`, `startMeasurementUpdates`).
  - Configuración de IP local `192.168.1.33` en `capacitor.config.json` para Live Reload.

### 🌐 Despliegue v1.0.2
- **Acción**: Publicación de la DApp con visualización de versión.
- **Comandos**: `yarn build && firebase deploy --only hosting:variofly`
- **Cambios**: 
  - Adición de campo `version` en `package.json`.
  - Rediseño del Top Bar para mostrar `v1.0.2` de forma dinámica desde el código.

## [2026-04-12] 15:33
### 🚀 Release v1.0.3
- **Acción**: Publicación oficial con mejoras de UI y UX.
- **Cambios**: 
  - Aumento de fuente en el Top Bar para pantallas de alta densidad.
  - Corrección de API `CapacitorBarometer` (`isAvailable`, `measurement`).
  - Logs informativos explícitos sobre la plataforma (Web vs Nativa).
- **Comandos**: `yarn build && firebase deploy --only hosting:variofly`

### 📋 Estado Actual
- **URL**: https://variofly.web.app (Versión: **v1.0.4**)
- **Local Dev**: https://192.168.1.33:9753
- **Capacitor**: Sincronizado para Android (v7.0.0).

## [2026-04-12] 16:05
### 🚀 Release v1.0.4
- **Acción**: Doble camino para acceso al barómetro (Chrome flags + APK nativo).
- **Cambios**: 
  - Agregado permiso `HIGH_SAMPLING_RATE_SENSORS` al AndroidManifest.xml.
  - Agregado `uses-feature` `android.hardware.sensor.barometer` (optional).
  - Mejorada la detección de sensor: logs detallados de cada API intentada.
  - Detección de Android browser: muestra instrucciones sobre `chrome://flags` "Generic Sensor Extra Classes".
  - `npx cap sync android` — plugin `@capgo/capacitor-barometer@7.2.8` sincronizado.
- **Comandos**: `yarn build && firebase deploy --only hosting:variofly && npx cap sync android`

---
*Este log se actualizará con cada cambio importante.*
