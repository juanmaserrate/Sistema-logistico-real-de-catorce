const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Web shims for native-only modules
const webShims = {
  'react-native-maps': path.resolve(__dirname, 'src/shims/react-native-maps.web.js'),
  'react-native-gesture-handler': path.resolve(__dirname, 'src/shims/react-native-gesture-handler.web.js'),
  'react-native-draggable-flatlist': path.resolve(__dirname, 'src/shims/react-native-draggable-flatlist.web.js'),
  'react-native-reanimated': path.resolve(__dirname, 'src/shims/react-native-reanimated.web.js'),
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && webShims[moduleName]) {
    return { type: 'sourceFile', filePath: webShims[moduleName] };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
