const { withAppBuildGradle } = require("expo/config-plugins");

// El Navigation SDK (com.google.android.libraries.navigation:navigation) trae
// las clases de com.google.android.gms.maps EMBEBIDAS dentro de su propio AAR.
// Por eso colisiona con play-services-maps (que trae react-native-maps).
// Solución: excluir play-services-maps globalmente. react-native-maps sigue
// funcionando porque las mismas clases las aporta el Navigation SDK.
const BLOCK = `
configurations.configureEach {
  exclude group: "com.google.android.gms", module: "play-services-maps"
}
`.trim();

module.exports = function withGoogleMapsDedup(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Limpiar versiones previas del bloque (condicional navsdk)
    contents = contents.replace(
      /configurations\.configureEach\s*\{\s*if\s*\(name\.contains\("ReactNativeNavigationSdk"\)[\s\S]*?\}\s*\}/,
      ''
    );
    // Limpiar el bloque global si ya existe para no duplicarlo
    contents = contents.replace(
      /configurations\.configureEach\s*\{\s*exclude group: "com\.google\.android\.gms", module: "play-services-maps"\s*\}/,
      ''
    );

    contents = `${contents.trimEnd()}\n\n${BLOCK}\n`;
    config.modResults.contents = contents;
    return config;
  });
};
