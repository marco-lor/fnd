import {CallableRequest, onCall} from "firebase-functions/v2/https";
import {levelUpAllTask06Handler} from "./backendOperations";

type LevelUpAllRequest = {
  operationId?: string;
  idempotencyKey?: string;
};

const REGION = "europe-west8";

export const levelUpAll = onCall(
  {region: REGION},
  (request: CallableRequest<LevelUpAllRequest>) =>
    levelUpAllTask06Handler(request)
);
