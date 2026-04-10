const { withAppBuildGradle } = require("expo/config-plugins");

// El Navigation SDK trae play-services-maps embebido.
// react-native-maps también necesita play-services-maps.
// Solución: usar resolutionStrategy para que ambas librerías usen la MISMA versión.
// Esto evita conflictos de clases duplicadas sin romper react-native-maps.
const BLOCK = `
configurations.configureEach {
  resolutionStrategy {
    force 'com.google.android.gms:play-services-maps:18.2.0'
  }
}
`.trim();

module.exports = function withGoogleMapsDedup(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Limpiar versiones previas (exclusión global)
    contents = contents.replace(
      /configurations\.configureEach\s*\{\s*exclude group: "com\.google\.android\.gms", module: "play-services-maps"\s*\}/,
      ''
    );
    // Limpiar condicionales viejos
    contents = contents.replace(
      /configurations\.configureEach\s*\{\s*if\s*\(name\.contains\("ReactNativeNavigationSdk"\)[\s\S]*?\}\s*\}/,
      ''
    );
    // Limpiar resolutionStrategy anterior si existe
    contents = contents.replace(
      /configurations\.configureEach\s*\{\s*resolutionStrategy\s*\{[\s\S]*?\}\s*\}/,
      ''
    );

    contents = `${contents.trimEnd()}\n\n${BLOCK}\n`;
    config.modResults.contents = contents;
    return config;
  });
};
