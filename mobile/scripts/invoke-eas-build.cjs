/**
 * Launches `npx eas-cli build` with cwd and INIT_CWD fixed to this app root
 * (parent of scripts/). Used from eas-build-temp.ps1 after robocopy to %TEMP% so
 * EAS never resolves the project or git root from OneDrive paths.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const profile = argv[0];
if (!profile) {
  console.error("Usage: node invoke-eas-build.cjs <preview|production|development> [extra eas build args...]");
  process.exit(1);
}
const easRest = argv.slice(1);

const env = { ...process.env };
for (const k of [
  "INIT_CWD",
  "npm_config_local_prefix",
  "PWD",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "EAS_NO_VCS",
]) {
  delete env[k];
}
env.INIT_CWD = appRoot;
env.npm_config_local_prefix = appRoot;
env.PWD = appRoot;

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npxArgs = [
  "-y",
  "eas-cli@latest",
  "build",
  "--non-interactive",
  "--platform",
  "android",
  "--profile",
  profile,
  ...easRest,
];

// Windows: shell:true helps npx.cmd resolve under spawnSync; inherit keeps live EAS progress output.
const spawnOpts = {
  stdio: "inherit",
  cwd: appRoot,
  env,
  windowsHide: false,
};
if (process.platform === "win32") {
  spawnOpts.shell = true;
}
const r = spawnSync(npx, npxArgs, spawnOpts);
const code = r.status == null ? 1 : r.status;
if (code !== 0) {
  if (r.error) console.error(r.error);
  console.error("eas-cli exited with code " + code + ". cwd=" + appRoot);
}
process.exit(code);
