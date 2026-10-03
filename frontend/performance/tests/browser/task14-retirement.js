const crypto = require('node:crypto');

// Count opened listeners as well as live ones: an immediately closed legacy
// subscription must still fail the retirement gate.
const summarizeRetirementActivity = (snapshot = {}, requests = []) => {
  const encounterEvents = (snapshot.events || []).filter(event => (
    event.category === 'firestore' && /(?:^|[./])encounters(?:[./]|$)/i.test(event.tags?.target || '')
  ));
  return {
    encounterListenerOpens: encounterEvents.filter(event => event.metric === 'listener-open').length,
    encounterWriteAttempts: encounterEvents.filter(event => event.metric === 'write-attempt').length,
    encounterRequests: requests.filter(request => request.encounterTarget).length,
    combatChunkRequests: requests.filter(request => /(?:route|feature)-combat|combat-tool/i.test(request.path)).length,
    activeEncounterListeners: Object.entries(snapshot.activeListeners || {})
      .filter(([key]) => /(?:^|[./:])encounters(?:[./]|$)/i.test(key))
      .reduce((sum, [, count]) => sum + Number(count || 0), 0),
  };
};

const classifyRetirementRequest = request => {
  const url = new URL(request.url());
  let payload = request.postData?.() || '';
  try { payload = decodeURIComponent(payload.replace(/\+/g, ' ')); } catch { /* retain malformed payload */ }
  return {
    path: url.pathname,
    encounterTarget: url.origin === 'http://127.0.0.1:8080'
      && /\bencounters\b/.test(`${url.pathname} ${payload}`),
  };
};

const summarizeEncounterHistory = rows => {
  const sorted = rows.filter(row => row.path.startsWith('encounters/'))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {
    encounters: sorted.filter(row => row.path.split('/').length === 2).length,
    participants: sorted.filter(row => row.path.split('/')[2] === 'participants').length,
    logs: sorted.filter(row => row.path.split('/')[2] === 'logs').length,
    digest: crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex'),
  };
};

module.exports = { classifyRetirementRequest, summarizeEncounterHistory, summarizeRetirementActivity };
