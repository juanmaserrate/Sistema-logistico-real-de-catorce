const { withProjectBuildGradle } = require("expo/config-plugins");

const BLOCK = `
subprojects { subproject ->
  configurations.configureEach {
    exclude group: "com.google.android.gms", module: "play-services-maps"
  }
}
`.trim();

module.exports = function withGoogleMapsDedup(config) {
  return withProjectBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (!contents.includes('exclude group: "com.google.android.gms", module: "play-services-maps"')) {
      config.modResults.contents = `${contents}\n\n${BLOCK}\n`;
    }
    return config;
  });
};
