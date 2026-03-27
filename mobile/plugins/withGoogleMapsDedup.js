const { withAppBuildGradle } = require("expo/config-plugins");

const BLOCK = `
configurations.configureEach {
  exclude group: "com.google.android.gms", module: "play-services-maps"
}
`.trim();

module.exports = function withGoogleMapsDedup(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (!contents.includes('exclude group: "com.google.android.gms", module: "play-services-maps"')) {
      config.modResults.contents = `${contents}\n\n${BLOCK}\n`;
    }
    return config;
  });
};
