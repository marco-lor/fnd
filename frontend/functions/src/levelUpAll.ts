import {CallableRequest, onCall} from "firebase-functions/v2/https";
import {levelUpAllTask06Handler} from "./backendOperations";
import {levelUpAllLegacyHandler} from "./levelUpAllLegacy";
import {asTrimmedString} from "./userDataV2";

type LevelUpAllRequest = {
  operationId?: string;
  idempotencyKey?: string;
};

const REGION = "europe-west8";

export const levelUpAll = onCall(
  {region: REGION},
  async (request: CallableRequest<LevelUpAllRequest>) => (
    asTrimmedString(request.data?.operationId)
      ? levelUpAllTask06Handler(request)
      : levelUpAllLegacyHandler(request)
  )
);
