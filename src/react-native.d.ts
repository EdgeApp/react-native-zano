declare module 'react-native' {
  import type { NativeZanoModule } from 'react-native-zano'
  declare const NativeModules: {
    ZanoModule: NativeZanoModule
  }
}
