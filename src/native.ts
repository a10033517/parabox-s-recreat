import { Capacitor } from '@capacitor/core'

// Native shell (iOS / Android via Capacitor) integration. In a browser every function here is
// a no-op, so the same build still runs as a web app / PWA.
export const isNativeApp = Capacitor.isNativePlatform()

export async function setupNativeShell(): Promise<void> {
  if (!isNativeApp) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    if (Capacitor.getPlatform() === 'android') await StatusBar.setBackgroundColor({ color: '#0b0b0b' })
  } catch {
    // Status bar styling is cosmetic.
  }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    // ignore
  }
}

// Android hardware / gesture back. The handler returns false when there is nowhere to go back
// to (the menu), and the app then closes as Android users expect.
export function onBackButton(handler: () => boolean): () => void {
  if (!isNativeApp) return () => {}
  let remove: (() => void) | undefined
  let cancelled = false
  import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('backButton', () => {
        if (!handler()) void App.exitApp()
      }),
    )
    .then((listener) => {
      if (cancelled) void listener.remove()
      else remove = () => void listener.remove()
    })
    .catch(() => {})
  return () => {
    cancelled = true
    remove?.()
  }
}
