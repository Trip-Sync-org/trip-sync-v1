/**
 * Windows + OneDrive: EAS tars the project; reading from OneDrive often fails
 * (Permission denied) and the server sees no mobile/package.json.
 * eas-build-temp.ps1 robocopies only repo/mobile/ to %LOCALAPPDATA%\\Temp (not the
 * whole monorepo) so nothing under api/ is archived and all tar I/O is local.
 * Staged git tree uses packages/mobile/ so EAS tar strip leaves build/mobile/.
 * Expo dashboard: Project root = "packages/mobile". Do not run npx eas
 * from the OneDrive monorepo — use npm run build:preview or this launcher.
 *
 * Usage: node eas-with-staging.cjs <preview|production> [-- ...extra eas args]
 */
const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");

const mobileDir = path.join(__dirname, "..");
const profile = process.argv[2];
if (!profile || !["preview", "production", "development"].includes(profile)) {
  console.error("Usage: node eas-with-staging.cjs <preview|production|development> [-- extra eas args]");
  process.exit(1);
}
const rest = process.argv.slice(3);

if (process.platform === "win32") {
  // npm run sets INIT_CWD to the folder you ran from (e.g. OneDrive\…\mobile).
  // EAS/Expo use that (and the process CWD) to find git + files for the upload. If
  // our child process CWD is OneDrive\…\mobile, "git" walks up to OneDrive\…\Trip-Sync
  // and tars that tree → tar: mobile/... Permission denied. So: never spawn from
  // the OneDrive app folder; use the system temp dir. PS1 uses -File and absolute
  // paths. INIT_CWD in PS1 points at the staged mobile/ copy. Do not set GIT_DIR in
  // env: EAS runs "git clone file://…" and GIT_DIR would break that.
  const ps1 = path.join(__dirname, "eas-build-temp.ps1");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ps1,
    "-BuildProfile",
    profile,
    ...rest,
  ];
  const env = { ...process.env };
  delete env.INIT_CWD;
  delete env.npm_config_local_prefix;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const spawnCwd = process.env.TEMP || process.env.TMP || os.tmpdir();
  const r = spawnSync("powershell.exe", args, { stdio: "inherit", cwd: spawnCwd, env });
  process.exit(r.status == null ? 1 : r.status);
}

const easArgs = [
  "eas-cli@latest",
  "build",
  "--non-interactive",
  "--platform",
  "android",
  "--profile",
  profile,
  ...rest,
];
const r = spawnSync("npx", ["-y", ...easArgs], { stdio: "inherit", cwd: mobileDir, env: process.env, shell: false });
process.exit(r.status == null ? 1 : r.status);
