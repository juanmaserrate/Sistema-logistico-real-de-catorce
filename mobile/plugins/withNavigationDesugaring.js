const { withAppBuildGradle } = require("expo/config-plugins");

const DESUGAR_LINE =
  'coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.1.4"';

module.exports = function withNavigationDesugaring(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Ensure coreLibraryDesugaring dependency exists
    if (!contents.includes("coreLibraryDesugaring \"com.android.tools:desugar_jdk_libs")) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    ${DESUGAR_LINE}`
      );
    }

    // Ensure compileOptions enables desugaring in app module
    const hasCompileOptions = /compileOptions\s*\{[\s\S]*coreLibraryDesugaringEnabled\s+true[\s\S]*\}/m.test(
      contents
    );

    if (!hasCompileOptions) {
      const compileBlock = `
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
        coreLibraryDesugaringEnabled true
    }`;

      // Insert inside android { ... } near the top
      contents = contents.replace(/android\s*\{/, `android {${compileBlock}`);
    }

    config.modResults.contents = contents;
    return config;
  });
};
