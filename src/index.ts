import { NativeModules } from 'react-native'
import { CppBridge, NativeZanoModule } from './CppBridge'

export function makeZano(): CppBridge {
  const { ZanoModule } = NativeModules
  if (ZanoModule == null) {
    throw new Error('react-native-zano native module not linked')
  }
  return new CppBridge(ZanoModule)
}

export type { CppBridge, NativeZanoModule }
