#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const buildDir = path.join(projectRoot, "build");
const verifyOnly = process.argv.includes("--verify-only");

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function stripPublicDebugArtifacts() {
  for (const filePath of walkFiles(buildDir)) {
    if (filePath.endsWith(".map")) {
      removeIfExists(filePath);
    }
  }

  removeIfExists(path.join(buildDir, "asset-manifest.json"));
}

function verifyHardenedBuild() {
  if (!fs.existsSync(path.join(buildDir, "index.html"))) {
    console.error("Production build output is missing. Run npm run build:production first.");
    process.exit(1);
  }

  const files = walkFiles(buildDir);
  const forbiddenFiles = files.filter((filePath) => (
    filePath.endsWith(".map")
    || path.basename(filePath) === "asset-manifest.json"
  ));

  const sourceMappingReferences = files.filter((filePath) => {
    if (!/\.(css|js|html)$/.test(filePath)) {
      return false;
    }

    return fs.readFileSync(filePath, "utf8").includes("sourceMappingURL");
  });

  if (forbiddenFiles.length || sourceMappingReferences.length) {
    console.error("Production build contains public debug artifacts.");
    for (const filePath of forbiddenFiles) {
      console.error(` - ${path.relative(projectRoot, filePath)}`);
    }
    for (const filePath of sourceMappingReferences) {
      console.error(` - ${path.relative(projectRoot, filePath)} contains sourceMappingURL`);
    }
    process.exit(1);
  }
}

if (!verifyOnly) {
  const build = spawnSync(
    process.execPath,
    [require.resolve("react-scripts/scripts/build")],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        GENERATE_SOURCEMAP: "false",
      },
      stdio: "inherit",
    }
  );

  if (build.status !== 0) {
    process.exit(build.status || 1);
  }

  stripPublicDebugArtifacts();
}

verifyHardenedBuild();
