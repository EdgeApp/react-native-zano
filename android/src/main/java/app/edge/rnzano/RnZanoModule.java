package app.edge.rnzano;

import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class RnZanoModule extends ReactContextBaseJavaModule {
  // Zano calls run on their own thread, never on the caller's. On the
  // legacy architecture every @ReactMethod runs on the shared
  // mqt_native_modules thread, which also executes UIManager's view
  // commands - so a Zano call that blocks in C++ (a close waiting out a
  // scan chunk, or the SDK's close-during-scan lock inversion) froze every
  // view update in the app. Static, because the Zano SDK is one instance
  // per process while React module instances are not: a JS reload builds a
  // new module while a call from the old one may still be draining, and
  // per-instance threads would let both drive the SDK at once. One
  // process-wide thread keeps the strict global call ordering, across
  // reloads too. Named, because this freeze was diagnosed from thread
  // dumps, and "pool-1-thread-1" will not identify itself in the next one.
  private static final ExecutorService executor =
      Executors.newSingleThreadExecutor(r -> new Thread(r, "zano"));

  private native String callZanoJNI(String method, String[] arguments);

  private native String[] getMethodNames();

  static {
    System.loadLibrary("rnzano");
  }

  public RnZanoModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public Map<String, Object> getConstants() {
    final Map<String, Object> constants = new HashMap<>();
    constants.put("methodNames", getMethodNames());
    constants.put("documentDirectory", getReactApplicationContext().getFilesDir().getAbsolutePath());
    return constants;
  }

  @Override
  public String getName() {
    return "ZanoModule";
  }

  @ReactMethod
  public void callZano(String method, ReadableArray arguments, Promise promise) {
    // Re-package the arguments:
    String[] strings = new String[arguments.size()];
    for (int i = 0; i < arguments.size(); ++i) {
      strings[i] = arguments.getString(i);
    }

    executor.execute(() -> {
      try {
        promise.resolve(callZanoJNI(method, strings));
      } catch (Throwable e) {
        // Throwable, not Exception: off the bridge thread an escaping Error
        // reaches the default uncaught handler and kills the process with
        // the promise unsettled; RN's own dispatcher used to catch it.
        promise.reject("ZanoError", e);
      }
    });
  }
}
