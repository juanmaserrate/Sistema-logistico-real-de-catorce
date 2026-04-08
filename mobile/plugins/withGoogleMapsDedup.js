const { withAppBuildGradle } = require("expo/config-plugins");

// Excluye el duplicado de play-services-maps SOLO de react-native-navigation-sdk
// para evitar conflicto de versiones, pero sin eliminar la librería que usa react-native-maps.
const BLOCK = `
configurations.configureEach {
  if (name.contains("ReactNativeNavigationSdk") || name.contains("navsdk")) {
    exclude group: "com.google.android.gms", module: "play-services-maps"
  }
}
`.trim();

module.exports = function withGoogleMapsDedup(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    // Remover el bloque problemático anterior si existe
    const old = `configurations.configureEach {\n  exclude group: "com.google.android.gms", module: "play-services-maps"\n}`;
    let updated = contents.replace(old, '');
    if (!updated.includes('if (name.contains("ReactNativeNavigationSdk")')) {
      updated = `${updated}\n\n${BLOCK}\n`;
    }
    config.modResults.contents = updated;
    return config;
  });
};
