const summarizeBazaarProfile = (snapshot, before = null) => {
  if (snapshot.droppedEventCount || before?.droppedEventCount) throw new Error('Incomplete profiler telemetry: dropped events.');
  const isCommit = event => event.category === 'react' && event.metric === 'commit' && event.tags?.id === 'Bazaar';
  const available = snapshot.events.some(isCommit);
  if (!available) return { available: false, count: null, totalMs: null, p95Ms: null, maximumMs: null };
  const durations = snapshot.events.slice(before?.events.length || 0).filter(isCommit).map(event => event.value);
  if (durations.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid profiler duration.');
  const sorted = [...durations].sort((a, b) => a - b);
  return { available: true, count: durations.length, totalMs: durations.reduce((sum, value) => sum + value, 0),
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    maximumMs: sorted.length ? sorted[sorted.length - 1] : null };
};
module.exports = { summarizeBazaarProfile };
