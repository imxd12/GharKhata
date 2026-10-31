/**
 * GharKhata – Real-Time Synchronization Broadcaster
 * Distributes real-time events to connected clients via Server-Sent Events (SSE)
 * alongside client-side Firebase Firestore synchronization.
 */

const clients = new Map(); // householdId -> Set of res objects

function registerClient(householdId, res) {
  if (!clients.has(householdId)) {
    clients.set(householdId, new Set());
  }
  clients.get(householdId).add(res);

  res.on('close', () => {
    if (clients.has(householdId)) {
      clients.get(householdId).delete(res);
      if (clients.get(householdId).size === 0) {
        clients.delete(householdId);
      }
    }
  });
}

function broadcastEvent(householdId, eventType, data = {}) {
  const payload = {
    type: eventType,
    householdId,
    timestamp: new Date().toISOString(),
    data
  };

  if (clients.has(householdId)) {
    const jsonStr = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients.get(householdId)) {
      try {
        res.write(jsonStr);
      } catch (err) {
        // Client might have disconnected
      }
    }
  }

  return payload;
}

module.exports = {
  registerClient,
  broadcastEvent
};

