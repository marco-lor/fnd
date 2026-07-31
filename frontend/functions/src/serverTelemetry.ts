import * as logger from "firebase-functions/logger";
import {operationCorrelationHash} from "./backendOperationCore";

export type ServerErrorClass =
  | "validation"
  | "authentication"
  | "authorization"
  | "conflict"
  | "dependency"
  | "deadline"
  | "storage"
  | "internal";

interface TelemetryCounts {
  reads?: number;
  writes?: number;
  copies?: number;
  deletes?: number;
  retries?: number;
}

interface TelemetryContext {
  functionKey: string;
  region: string;
  invocationType: "callable" | "trigger" | "worker";
  startedAt: number;
  coldStart: boolean;
  correlationHash?: string;
}

let coldStart = true;

export const startServerTelemetry = (input: {
  functionKey: string;
  region: string;
  invocationType: TelemetryContext["invocationType"];
  receiptId?: string;
}): TelemetryContext => {
  const context: TelemetryContext = {
    functionKey: input.functionKey,
    region: input.region,
    invocationType: input.invocationType,
    startedAt: Date.now(),
    coldStart,
    ...(input.receiptId ? {
      correlationHash: operationCorrelationHash(input.receiptId),
    } : {}),
  };
  coldStart = false;
  logger.info("server_work_started", {
    functionKey: context.functionKey,
    region: context.region,
    invocationType: context.invocationType,
    coldStart: context.coldStart,
    correlationHash: context.correlationHash,
  });
  return context;
};

export const completeServerTelemetry = (
  context: TelemetryContext,
  input: TelemetryCounts & {
    outcome?: string;
    phase?: string;
    replayed?: boolean;
  } = {}
): void => {
  logger.info("server_work_completed", {
    functionKey: context.functionKey,
    region: context.region,
    invocationType: context.invocationType,
    coldStart: context.coldStart,
    correlationHash: context.correlationHash,
    durationMs: Date.now() - context.startedAt,
    outcome: input.outcome ?? "success",
    phase: input.phase,
    replayed: input.replayed === true,
    reads: input.reads ?? 0,
    writes: input.writes ?? 0,
    copies: input.copies ?? 0,
    deletes: input.deletes ?? 0,
    retries: input.retries ?? 0,
  });
};

export const failServerTelemetry = (
  context: TelemetryContext,
  errorClass: ServerErrorClass,
  input: TelemetryCounts & {phase?: string} = {}
): void => {
  logger.error("server_work_failed", {
    functionKey: context.functionKey,
    region: context.region,
    invocationType: context.invocationType,
    coldStart: context.coldStart,
    correlationHash: context.correlationHash,
    durationMs: Date.now() - context.startedAt,
    errorClass,
    phase: input.phase,
    reads: input.reads ?? 0,
    writes: input.writes ?? 0,
    copies: input.copies ?? 0,
    deletes: input.deletes ?? 0,
    retries: input.retries ?? 0,
  });
};
