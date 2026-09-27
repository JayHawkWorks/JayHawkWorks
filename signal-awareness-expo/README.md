# Signal Awareness Mobile — Expo Go

This branch contains a no-PC / no-paid-Apple-Developer Expo Go edition of Signal Awareness.

## Open on iPhone

1. Install Expo Go from the App Store.
2. Open this Snack URL in Safari:
https://snack.expo.dev/?platform=mydevice&name=Signal%20Awareness%20Mobile&description=Local%20field%20situational%20awareness%20for%20Expo%20Go&theme=dark&sdkVersion=57.0.0&dependencies=expo-location%2Cexpo-sensors%2Cexpo-camera%2Cexpo-file-system%2Cexpo-sharing%2Creact-native-maps%2C%40react-native-async-storage%2Fasync-storage%2C%40expo%2Fvector-icons&sourceUrl=https%3A%2F%2Fraw.githubusercontent.com%2FJayHawkWorks%2FJayHawkWorks%2Fsignal-awareness-expo-go%2Fsignal-awareness-expo%2FApp.js
3. Choose the option to open/run on your device in Expo Go.
4. Grant Location and Camera permissions when requested.

## Current capabilities

- GPS field sessions and route logging
- Heading / compass
- Magnetometer, accelerometer, gyroscope
- Native map with route and observation markers
- Manual/external signal observations with RSSI
- Signal history and NEW / KNOWN / REPEATED / FREQUENT / TRACKED states
- Camera Finder with estimated heading and manual/external RSSI samples
- RF reference catalog and user-defined regional references
- Local persistent storage
- CSV / JSON / GPX export
- JSON import for external WebBluetooth / Android / ESP32 / SDR observations

## Platform limits

Standard Expo Go on iOS does not provide unrestricted BLE scanning or surrounding Wi-Fi AP scanning. The app reports these limits instead of fabricating data. A future WebBluetooth or external sensor bridge can feed those observations into the same local data model.
