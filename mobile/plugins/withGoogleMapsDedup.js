const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withGoogleMapsDedup(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Remover cualquier bloque anterior
    contents = contents.replace(/configurations\.configureEach\s*\{[\s\S]*?\}/g, '');

    // NO excluir play-services-maps. En lugar de eso, forzar que ambas
    // librerías usen la MISMA versión para evitar conflictos.
    // Navigation SDK + react-native-maps ambas pueden compartir play-services-maps 18.2.0
    if (!contents.includes('force ')) {
      const block = `
configurations.all {
  resolutionStrategy {
    force 'com.google.android.gms:play-services-maps:18.2.0'
  }
}`;
      contents = contents.trimEnd() + '\n' + block + '\n';
    }

    config.modResults.contents = contents;
    return config;
  });
};
