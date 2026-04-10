const { withAppBuildGradle } = require("expo/config-plugins");

// Navigation SDK embeds Google Maps classes internally.
// Excluding play-services-maps globally prevents duplicate class errors at compile time.
// react-native-maps still works because Navigation SDK provides the same classes.
const BLOCK = `
configurations.configureEach {
  exclude group: "com.google.android.gms", module: "play-services-maps"
}
`.trim();

module.exports = function withGoogleMapsDedup(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Remove any previous version of this block
    contents = contents.replace(
      /configurations\.configureEach\s*\{\s*\n?\s*exclude group: "com\.google\.android\.gms", module: "play-services-maps"\s*\n?\s*\}/g,
      ''
    );
    contents = contents.replace(
      /configurations\.configureEach\s*\{\s*\n?\s*resolutionStrategy[\s\S]*?\}\s*\n?\s*\}/g,
      ''
    );
    contents = contents.replace(
      /configurations\.all\s*\{\s*\n?\s*resolutionStrategy[\s\S]*?\}\s*\n?\s*\}/g,
      ''
    );

    contents = `${contents.trimEnd()}\n\n${BLOCK}\n`;
    config.modResults.contents = contents;
    return config;
  });
};
