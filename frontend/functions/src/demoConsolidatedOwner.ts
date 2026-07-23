import {readFileSync} from "fs";
import {resolve} from "path";

const DEMO_PROJECT_ID = "demo-fnd-perf";
const CONSOLIDATED_FLAG = "FND_TASK06_CONSOLIDATED_OWNER";

type Environment = Record<string, string | undefined>;

export const usesDemoConsolidatedOwner = (
  environment: Environment = process.env,
  readEnvironmentFile: (filePath: string) => string = (
    filePath
  ) => readFileSync(filePath, "utf8")
): boolean => {
  const projectIds = [
    environment.GCLOUD_PROJECT,
    environment.GOOGLE_CLOUD_PROJECT,
    environment.FATINS_FIREBASE_PROJECT_ID,
  ].filter((value): value is string => Boolean(value));
  if (
    !projectIds.length ||
    projectIds.some((projectId) => projectId !== DEMO_PROJECT_ID)
  ) {
    return false;
  }
  if (environment[CONSOLIDATED_FLAG] === "1") return true;

  try {
    const contents = readEnvironmentFile(resolve(
      __dirname,
      "..",
      `.env.${DEMO_PROJECT_ID}`
    ));
    return contents.split(/\r?\n/).some((line) => (
      line.trim() === `${CONSOLIDATED_FLAG}=1`
    ));
  } catch {
    return false;
  }
};
