const DEMO_PROJECT_ID = "demo-fnd-perf";

const projectId = (): string => (
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_CONFIG && (() => {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_CONFIG || "{}") as {
        projectId?: unknown;
      };
      return typeof parsed.projectId === "string" ? parsed.projectId : "";
    } catch {
      return "";
    }
  })() ||
  ""
);

export const task07CallableEnforcesAppCheck = (
  environment: NodeJS.ProcessEnv = process.env
): boolean => !(
  environment.FUNCTIONS_EMULATOR === "true" &&
  (
    environment.GCLOUD_PROJECT === DEMO_PROJECT_ID ||
    environment.GOOGLE_CLOUD_PROJECT === DEMO_PROJECT_ID ||
    (() => {
      try {
        const parsed = JSON.parse(environment.FIREBASE_CONFIG || "{}") as {
          projectId?: unknown;
        };
        return parsed.projectId === DEMO_PROJECT_ID;
      } catch {
        return false;
      }
    })()
  )
);

export const TASK07_CALLABLE_OPTIONS = Object.freeze({
  region: "europe-west8",
  enforceAppCheck: task07CallableEnforcesAppCheck(),
});

export const assertTask07DemoEmulatorBypassIsExact = (): void => {
  if (!TASK07_CALLABLE_OPTIONS.enforceAppCheck &&
    projectId() !== DEMO_PROJECT_ID) {
    throw new Error("task07-app-check-bypass-project-mismatch");
  }
};
