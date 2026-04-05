// Fixes Metro resolving `./DateTimePickerAndroid` on some Windows / OneDrive installs.
const { getDefaultConfig } = require("expo/metro-config");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Allow importing shared `../shared/voiceConstants.js` from the repo root
config.watchFolders = [path.resolve(projectRoot, "..")];

// Monorepo: the repo root may install a different `react-native` (and `react`) than `mobile/`.
// `watchFolders` includes the parent, so Metro can otherwise resolve two copies and crash at runtime
// with "Cannot read property 'EventEmitter' of undefined" when RN internals mix instances.
const mobileNodeModules = path.join(projectRoot, "node_modules");
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.join(mobileNodeModules, "react"),
  "react-dom": path.join(mobileNodeModules, "react-dom"),
  "react-native": path.join(mobileNodeModules, "react-native"),
};

// Monorepo: some packages resolve from the parent `node_modules` while `react-native-web`
// only exists under `mobile/node_modules`. Web bundling then asks for deep paths like
// `react-native-web/dist/exports/PixelRatio` which must map to `.../PixelRatio/index.js`.
const rnWebRoot = path.join(projectRoot, "node_modules", "react-native-web");

const dtPickerSrc = path.join(
  projectRoot,
  "node_modules/@react-native-community/datetimepicker/src",
);

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    typeof moduleName === "string" &&
    moduleName.startsWith("react-native-web/dist/exports/")
  ) {
    const rel = moduleName.slice("react-native-web/".length);
    const indexPath = path.join(rnWebRoot, rel, "index.js");
    if (fs.existsSync(indexPath)) {
      return { type: "sourceFile", filePath: indexPath };
    }
  }
  if (
    moduleName === "./DateTimePickerAndroid" &&
    typeof context.originModulePath === "string" &&
    context.originModulePath.includes("@react-native-community/datetimepicker")
  ) {
    const file =
      platform === "android"
        ? "DateTimePickerAndroid.android.js"
        : "DateTimePickerAndroid.js";
    return {
      filePath: path.join(dtPickerSrc, file),
      type: "sourceFile",
    };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
