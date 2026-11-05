const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Alias AssetRegistry for web bundler
const assetRegistryPath = path.resolve(
  __dirname,
  'node_modules/react-native-web/dist/modules/AssetRegistry/index.js'
);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@react-native/assets-registry/registry': assetRegistryPath,
  '@react-native/assets-registry': assetRegistryPath,
  'react-native-web/dist/exports/AssetRegistry': assetRegistryPath,
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === '@react-native/assets-registry/registry' ||
    moduleName === '@react-native/assets-registry' ||
    moduleName === 'react-native-web/dist/exports/AssetRegistry'
  ) {
    return {
      filePath: assetRegistryPath,
      type: 'sourceFile',
    };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

