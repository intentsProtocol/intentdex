// withWorkletAddons.js
//
// Expo Config Plugin — two Bare workers in one app, and the native addons of both.
//
// The app runs two Bare workers: the WDK worklet (keys, signing) and QVAC's worker (the on-device model).
// react-native-bare-kit 0.16 builds whatever addons sit in its `android/src/main/addons` folder, and links none
// by itself. QVAC's own plugin (`@qvac/sdk/expo-plugin`) bundles its worker, links that worker's addons into
// the folder, and empties the folder first. Applied alone, it would leave the wallet worklet without its
// addons, and the worklet would abort at start with ADDON_NOT_FOUND.
//
// So this plugin applies QVAC's plugin itself and adds a step that runs *after* it: linking the addons the
// WDK worklet bundle records (scripts/link-wdk-addons.mjs). Expo runs dangerous mods in reverse order of
// registration, so the step is registered first. Use this plugin in app.json instead of QVAC's.
//
// Options are passed on to QVAC's plugin.

const { withDangerousMod } = require('expo/config-plugins');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function qvacPlugin() {
  // QVAC's plugin is an ES module; Node 22.12+ can require it.
  const mod = require('@qvac/sdk/expo-plugin');
  return mod.default ?? mod.withQvacSDK ?? mod;
}

function withWorkletAddons(config, options = {}) {
  config = withDangerousMod(config, ['android', async mod => {
    const script = path.join(mod.modRequest.projectRoot, 'scripts', 'link-wdk-addons.mjs');
    const { linkWdkAddons } = await import(pathToFileURL(script).href);
    const { expected, skipped } = await linkWdkAddons();
    console.log(`🔗 WDK worklet: linked ${expected.length - skipped.length} native addons after QVAC's`);
    return mod;
  }]);
  return qvacPlugin()(config, options);
}

module.exports = withWorkletAddons;
