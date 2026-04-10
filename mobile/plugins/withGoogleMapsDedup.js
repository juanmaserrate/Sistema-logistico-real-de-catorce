const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withGoogleMapsDedup(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Remover cualquier bloque de exclusión anterior
    contents = contents.replace(
      /configurations\.configureEach\s*\{\s*exclude group:[^}]*play-services-maps[^}]*\}/g,
      ''
    );

    // Agregar exclusión si no existe
    if (!contents.includes('exclude group: "com.google.android.gms", module: "play-services-maps"')) {
      const exclusionBlock = `
configurations.configureEach {
  exclude group: "com.google.android.gms", module: "play-services-maps"
}`;
      // Insertar al final del archivo
      contents = contents.trimEnd() + '\n' + exclusionBlock + '\n';
    }

    config.modResults.contents = contents;
    return config;
  });
};
