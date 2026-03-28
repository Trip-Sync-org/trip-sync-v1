// Fixes Metro resolving `./DateTimePickerAndroid` on some Windows / OneDrive installs.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const dtPickerSrc = path.join(
  projectRoot,
  "node_modules/@react-native-community/datetimepicker/src",
);

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
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
