import {
  loadTask07MediaMode,
  task07ModeReadsDerivatives,
  task07ModeWritesV1,
} from './task07MediaControl';

// Kept only as a fail-closed compatibility export for code-splitting tests.
// A build flag can no longer activate Task 07 without the Task 04 control
// document and all three allowlists.
export const TASK07_MEDIA_PIPELINE_ENABLED = false;

export const getTask07MediaMode = (actor) => loadTask07MediaMode(actor);

export const isTask07MediaDerivativeReadEnabled = async (actor) => (
  task07ModeReadsDerivatives(await loadTask07MediaMode(actor))
);

export const isTask07MediaV1WriteEnabled = async (actor) => (
  task07ModeWritesV1(await loadTask07MediaMode(actor))
);
