const MAX_RETAINED_FIVE_PEER_REQUEST_FAILURES = 16;

const summarizeFivePeerSuccessDiagnostics = (peerPages, {
  explainedStartupWarningCount = 0,
} = {}) => ({
  explainedStartupWarningCount: Number(explainedStartupWarningCount || 0),
  peers: peerPages.map(({ role, diagnostics }) => ({
    role,
    visibilityState: diagnostics.visibilityState || 'unknown',
    assetSettlement: {
      networkPendingCount: Number(diagnostics.assetSettlement?.network?.pendingCount || 0),
      registryActiveRequestCount: Number(
        diagnostics.assetSettlement?.registry?.activeRequestCount || 0
      ),
      registryQueuedRequestCount: Number(
        diagnostics.assetSettlement?.registry?.queuedRequestCount || 0
      ),
    },
    requestFailureCounts: {
      unexpected: Number(diagnostics.failedRequestCount || 0),
      activeWriteTurnover: Number(diagnostics.explainedActiveWriteTurnoverCount || 0),
      cleanupTransportCancellation: Number(
        diagnostics.explainedCleanupTransportCancellationCount || 0
      ),
      recaptchaCancellation: Number(diagnostics.explainedRecaptchaCancellationCount || 0),
      diagnosticError: Number(diagnostics.requestFailureDiagnosticErrorCount || 0),
    },
  })),
});

const createFivePeerFailureAttachment = (peerPages) => ({
  schemaVersion: 1,
  peers: peerPages.map(({ role, diagnostics }) => ({
    role,
    counts: {
      unexpected: diagnostics.failedRequestCount,
      activeWriteTurnover: diagnostics.explainedActiveWriteTurnoverCount,
      cleanupTransportCancellation: diagnostics.explainedCleanupTransportCancellationCount,
      recaptchaCancellation: diagnostics.explainedRecaptchaCancellationCount,
      diagnosticError: diagnostics.requestFailureDiagnosticErrorCount,
    },
    omitted: {
      unexpected: Math.max(0, diagnostics.failedRequestCount - diagnostics.failedRequests.length),
      activeWriteTurnover: Math.max(
        0,
        diagnostics.explainedActiveWriteTurnoverCount
          - diagnostics.explainedActiveWriteTurnovers.length
      ),
      cleanupTransportCancellation: Math.max(
        0,
        diagnostics.explainedCleanupTransportCancellationCount
          - diagnostics.explainedCleanupTransportCancellations.length
      ),
      recaptchaCancellation: Math.max(
        0,
        diagnostics.explainedRecaptchaCancellationCount
          - diagnostics.explainedRecaptchaCancellations.length
      ),
      diagnosticError: Math.max(
        0,
        diagnostics.requestFailureDiagnosticErrorCount
          - diagnostics.requestFailureDiagnosticErrors.length
      ),
    },
    evidence: {
      unexpected: diagnostics.failedRequests,
      activeWriteTurnover: diagnostics.explainedActiveWriteTurnovers,
      cleanupTransportCancellation: diagnostics.explainedCleanupTransportCancellations,
      recaptchaCancellation: diagnostics.explainedRecaptchaCancellations,
    },
    diagnosticErrors: diagnostics.requestFailureDiagnosticErrors,
  })),
});

module.exports = {
  MAX_RETAINED_FIVE_PEER_REQUEST_FAILURES,
  createFivePeerFailureAttachment,
  summarizeFivePeerSuccessDiagnostics,
};
