// A thin overlay on app.json. Everything static stays there; only what a build has to override lives here.
//
// dotenv is loaded by hand because `eas build` does not read .env the way `npx expo` does.
require('dotenv').config();

module.exports = ({ config }) => ({
  ...config,
  slug: process.env.EAS_PROJECT_SLUG || config.slug,
  owner: process.env.EAS_OWNER || config.owner,
  ios: { ...config.ios, bundleIdentifier: process.env.IOS_BUNDLE_IDENTIFIER || config.ios.bundleIdentifier },
  android: { ...config.android, package: process.env.ANDROID_PACKAGE_NAME || config.android.package },
  extra: {
    ...config.extra,
    // `eas init` writes the project id into app.json; an environment variable wins, for CI.
    eas: { ...config.extra?.eas, ...(process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : {}) },
  },
});
