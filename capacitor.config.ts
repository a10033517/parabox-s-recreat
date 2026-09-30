import type { CapacitorConfig } from '@capacitor/cli'

// Native (iOS / Android) shell around the web build in dist/ (built with `npm run build:app`).
// appId must be unique on the stores and cannot change after the first release — replace the
// placeholder below with your own reverse-domain id before publishing.
const config: CapacitorConfig = {
  appId: 'com.zivchen.paraboxtribute',
  appName: 'Parabox Tribute',
  webDir: 'dist',
  backgroundColor: '#0b0b0b',
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#0b0b0b', showSpinner: false },
  },
}

export default config
