#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { execFileSync } = require("child_process");
const {
  requiredValue,
  resolveBranchName,
  resolveEnvironmentSelection,
} = require("./firebase-environment");
const {
  HOSTING_RELEASE_ENVIRONMENT,
  withForcedEnvironment,
} = require("./forced-release-environment");

const projectRoot = path.resolve(__dirname, "..");
const buildDir = path.join(projectRoot, "build");

const parseArguments = (args = process.argv.slice(2)) => {
  const options = {
    environmentName: "",
    projectId: "",
    hostingSite: "",
    storageBucket: "",
    verifyOnly: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--verify-only") {
      options.verifyOnly = true;
      continue;
    }
    if (["--environment", "--project", "--site", "--bucket"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === "--environment") options.environmentName = value;
      if (argument === "--project") options.projectId = value;
      if (argument === "--site") options.hostingSite = value;
      if (argument === "--bucket") options.storageBucket = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
};

const readGitBranchOutput = (environment = process.env) => {
  if (environment.FND_GIT_BRANCH || environment.GITHUB_HEAD_REF || environment.GITHUB_REF_NAME) {
    return "";
  }
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (_error) {
    return "";
  }
};

const resolveBuildSelection = ({
  environment = process.env,
  options = parseArguments([]),
  branchName,
} = {}) => {
  const resolvedBranchName = branchName || resolveBranchName({
    environment,
    gitBranchOutput: readGitBranchOutput(environment),
  });
  return resolveEnvironmentSelection({
    branchName: resolvedBranchName,
    environmentName: requiredValue(
      options.environmentName || environment.FND_FIREBASE_ENVIRONMENT,
      "Firebase environment"
    ),
    hostingSite: requiredValue(
      options.hostingSite || environment.FND_FIREBASE_HOSTING_SITE,
      "Firebase Hosting site"
    ),
    projectId: requiredValue(
      options.projectId || environment.FND_FIREBASE_PROJECT_ID,
      "Firebase project"
    ),
    storageBucket: requiredValue(
      options.storageBucket || environment.FND_FIREBASE_STORAGE_BUCKET,
      "Firebase Storage bucket"
    ),
  });
};

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
  const textFiles = files.filter((filePath) => /\.(css|js|html)$/.test(filePath));
  const forbiddenFiles = files.filter((filePath) => (
    filePath.endsWith(".map")
    || path.basename(filePath) === "asset-manifest.json"
  ));
  const misplacedCommonJsModules = files.filter((filePath) => filePath.endsWith(".cjs"));

  const sourceMappingReferences = textFiles.filter((filePath) => (
    fs.readFileSync(filePath, "utf8").includes("sourceMappingURL")
  ));

  const googleApiKeyPattern = /\bAIza[0-9A-Za-z_-]{35}\b/;
  const leakedApiKeyFiles = textFiles.filter((filePath) => (
    googleApiKeyPattern.test(fs.readFileSync(filePath, "utf8"))
  ));

  if (
    forbiddenFiles.length
    || misplacedCommonJsModules.length
    || sourceMappingReferences.length
    || leakedApiKeyFiles.length
  ) {
    console.error("Production build contains public debug artifacts, misplaced modules, or API key material.");
    for (const filePath of forbiddenFiles) {
      console.error(` - ${path.relative(projectRoot, filePath)}`);
    }
    for (const filePath of sourceMappingReferences) {
      console.error(` - ${path.relative(projectRoot, filePath)} contains sourceMappingURL`);
    }
    for (const filePath of misplacedCommonJsModules) {
      console.error(` - ${path.relative(projectRoot, filePath)} was emitted as a static asset instead of bundled JavaScript`);
    }
    for (const filePath of leakedApiKeyFiles) {
      console.error(` - ${path.relative(projectRoot, filePath)} contains a Google API key pattern`);
    }
    process.exit(1);
  }
}

const main = () => {
  const options = parseArguments();
  const environment = process.env;
  const branchName = resolveBranchName({
    environment,
    gitBranchOutput: readGitBranchOutput(environment),
  });
  const selection = resolveBuildSelection({options, environment, branchName});
  const buildEnvironment = withForcedEnvironment(process.env, {
    ...HOSTING_RELEASE_ENVIRONMENT,
    REACT_APP_FND_ENVIRONMENT: selection.name,
    REACT_APP_FND_FIREBASE_AUTH_DOMAIN: selection.authDomain,
    REACT_APP_FND_FIREBASE_PROJECT_ID: selection.projectId,
    REACT_APP_FND_FIREBASE_HOSTING_SITE: selection.hostingSite,
    REACT_APP_FND_FIREBASE_STORAGE_BUCKET: selection.storageBucket,
    FND_FIREBASE_ENVIRONMENT: selection.name,
    FND_FIREBASE_AUTH_DOMAIN: selection.authDomain,
    FND_FIREBASE_PROJECT_ID: selection.projectId,
    FND_FIREBASE_HOSTING_SITE: selection.hostingSite,
    FND_FIREBASE_STORAGE_BUCKET: selection.storageBucket,
    FND_GIT_BRANCH: branchName,
  });

  if (!options.verifyOnly) {
    const build = spawnSync(
      process.execPath,
      [require.resolve("react-scripts/scripts/build")],
      {
        cwd: projectRoot,
        env: buildEnvironment,
        stdio: "inherit",
      }
    );

    if (build.status !== 0) {
      process.exit(build.status || 1);
    }

    stripPublicDebugArtifacts();
  }

  verifyHardenedBuild();
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArguments,
  readGitBranchOutput,
  resolveBuildSelection,
};
