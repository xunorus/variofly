# VARIO · Parapente

VARIO is a premium, high-performance paragliding variometer. While it can run as a PWA, it is designed to be installed as a **Native Android App** to unlock full hardware sensor potential (Capacitor Native Bridge). It provides real-time altitude, pressure, and vertical speed (m/s) data with high-fidelity acoustic feedback and secure Ethereum-based flight logging.

## 🚀 Getting Started

### Native Android (Recommended)
For the best performance and reliable sensor access (especially on devices like the Samsung S10/S21), use the native Android build:

1. Open the `/android` project in **Android Studio**.
2. Build and deploy the APK to your device.
3. This unlocks the `CapacitorBarometer` native bridge, bypassing browser limitations.

### Prerequisites

- **Node.js** (v18+)
- **Yarn** (v4.x) - This project uses [Yarn Plug'n'Play (PnP)](https://yarnpkg.com/features/pnp) for strict, efficient dependency management.

### Installation

Install the dependencies:

```bash
yarn install
```

## 🚀 Despliegue en Firebase Hosting

Para obtener la mejor compatibilidad con los sensores del S10 Plus, se recomienda desplegar la DApp en **Firebase Hosting** (HTTPS nativo).

1.  **Instalar Firebase CLI** (si no lo tenés):
    ```bash
    npm install -g firebase-tools
    ```

2.  **Login e Inicio de Proyecto**:
    ```bash
    firebase login
    firebase init hosting
    ```
    *(Elegí "Use an existing project" o "Create new", configurá el directorio público como **`dist`** y respondé "Yes" a Single Page App).*

3.  **Compilar y Desplegar**:
    ```bash
    yarn build
    firebase deploy --only hosting:variofly
    ```

Entrá a `https://variofly.web.app` en tu S10 Plus para la prueba definitiva.

## ✨ Características

- **Real-time Variometer**: High-accuracy visual and acoustic feedback for climb/sink rates.
- **Variometer Logic & Sound Thresholds**:
  - **Climb (Subida)**: Acoustic feedback starts at **+0.2 m/s**. It uses intermittent "pips" where both the frequency (700Hz–1300Hz) and the repetition rate increase as the climb rate intensifies.
  - **Sink (Bajada)**: A continuous descending "sink tone" (sawtooth wave) starts at **-0.5 m/s** to alert the pilot of significant sink.
  - **Dead Band**: Silence is maintained between **-0.5 m/s and +0.2 m/s** to avoid noise during level flight.
  - **Data Processing**: Uses an IIR low-pass filter (smoothing factor 0.25) to stabilize readings and a 20m/s delta clamp to eliminate hardware sensor spikes.
- **Glassmorphic UI**: A state-of-the-art interface designed for high visibility during flight using neon accents and dark mode.
- **Hybrid Native Power**: Seamlessly switches between Capacitor Native Barometer (for Android App) and Browser APIs (for PWA), ensuring the best possible data source is used.
- **Installable Experience**: Available as a native Android APK for zero-latency sensor access or as a PWA for quick use.
- **Audio Feedback**: Configurable acoustic variometer with volume slider and mute controls.

## 🛠 Tech Stack

- **Build Tool**: [Parcel 2](https://parceljs.org/)
- **Logic**: Vanilla JavaScript (ES Module-based)
- **Styling**: Modern CSS3 with Flexbox/Grid and custom properties
- **Blockchain**: [Ethers.js v6](https://docs.ethers.org/v6/)
- **Package Manager**: Yarn Berry (v4.6.0) with PnP

## 📄 License

MIT
