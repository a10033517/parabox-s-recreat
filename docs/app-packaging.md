# 打包成 iOS / Android App

本專案用 [Capacitor](https://capacitorjs.com/) 把網頁版(Vite + React)包成原生 App,遊戲程式碼不用改寫。

- `android/`:Android Studio 專案
- `ios/`:Xcode 專案(使用 Swift Package Manager,不需要 CocoaPods)
- `capacitor.config.ts`:App ID、名稱、啟動畫面設定
- `src/native.ts`:原生平台整合(狀態列樣式、Android 返回鍵)。在瀏覽器中不做任何事。

## 發布前必改

`capacitor.config.ts` 的 `appId`(目前是 `com.zivchen.paraboxtribute`)。這是商店中的唯一識別碼,第一次上架後就不能再改。改完要重新產生原生專案,或手動同步修改 `android/app/build.gradle` 的 `applicationId` 和 Xcode 的 Bundle Identifier。

## 平常的流程

```bash
npm run cap:sync      # 以 App 模式建置網頁(不含 service worker、使用相對路徑)並複製到兩個原生專案
```

每次改完遊戲程式碼,都要先跑這一步,再建置原生 App。

## Android(Windows 可以直接做)

需要 JDK 21 和 Android SDK(已設定 `ANDROID_HOME`)。

```bash
npm run android:apk   # 同步後建置測試版 APK
```

輸出:`android/app/build/outputs/apk/debug/app-debug.apk`,可以直接裝到手機上測試(手機要允許安裝未知來源的 App)。

要上架 Google Play,需要簽章的 App Bundle(`.aab`):

1. `npm run android:open` 用 Android Studio 開啟專案。
2. 選單 **Build → Generate Signed App Bundle / APK**,建立或選擇 keystore。**keystore 要妥善備份**,遺失了就無法更新 App。
3. 上傳到 Google Play Console(需要開發者帳號,一次性費用 25 美元)。

## iOS(必須在 Mac 上)

iOS App 只能用 macOS 上的 Xcode 建置。Windows 做不到,這是 Apple 的限制。

1. 把專案複製到 Mac,執行 `npm install` 和 `npm run cap:sync`。
2. `npm run ios:open` 用 Xcode 開啟。
3. 在 **Signing & Capabilities** 選擇你的 Apple 開發者 Team。
4. 接上 iPhone 直接執行測試;要上架就用 **Product → Archive**,再上傳到 App Store Connect(需要 Apple Developer Program,每年 99 美元)。

沒有 Mac 的替代方案:雲端建置服務,例如 Ionic Appflow、Codemagic、GitHub Actions 的 macOS runner。

## 圖示與啟動畫面

- 原始圖:`assets/icon.svg`,由 `assets/icon-source.mjs` 產生(一個套著自己的藍色房間)。
- `assets/icon-only.png`、`assets/logo.png`:1024×1024 的 PNG,用無頭 Chrome 從 SVG 轉出。
- 重新產生所有尺寸:

```bash
npx capacitor-assets generate --iconBackgroundColor '#0b0b0b' --iconBackgroundColorDark '#0b0b0b' --splashBackgroundColor '#0b0b0b' --splashBackgroundColorDark '#0b0b0b' --logoSplashScale 0.3 --android --ios
```

## 上架前的注意事項

- **名稱與內容**:「Parabox」是 Patrick's Parabox 的名稱。商店可能以商標為由拒絕上架,或之後被下架。上架前最好換一個自己的名稱。
- **社群關卡**:`src/levels/builtin/community-samples/` 來自第三方編輯器 Parafox 的範例,沒有標示授權(見 `docs/differential/community-samples/README.md`)。公開發布前應移除,或取得授權。
- 兩個平台都鎖定直向(iPad 仍支援所有方向,這是 Apple 的要求)。
