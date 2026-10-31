module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
            // The shared package is TypeScript source, copied into vendor/ (see scripts/sync-vendor.mjs).
            '@bch-intents/wallet-core': './vendor/wallet-core/src',
          },
        },
      ],
    ],
  };
};
