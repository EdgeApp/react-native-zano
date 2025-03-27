# react-native-zano

This library packages Zano C++ client for use on React Native.

## Usage

First, add this library to your React Native app using NPM or Yarn, and run `pod install` as necessary to integrate it with your app's native code.

Here is a simple usage example. Note the `await` on the method call, but not on the require:

```js
import { makeZano } from 'react-native-zano'

const zano = makeZano()
const address = await zano.decodeAddress(...)
```

We have types too, if you need those:

```ts
import type { CppBridge } from 'react-native-zano'
```

The available methods are:

- hello

## Developing

This library relies on a large amount of native C++ code from other repos. To integrate this code, you must run the following script before publishing this library to NPM:

```sh
npm run update-sources
```

This script does the following tasks:

- Download third-party source code.
- Compile an iOS universal static library and put it into an XCFramework.

The `update-sources` script is also the place to make edits when upgrading any of the third-party dependencies. The react-native-zano repo doesn't include these third-party C++ sources, since they are enormous.
