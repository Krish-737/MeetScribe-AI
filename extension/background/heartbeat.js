// Chrome MV3 service workers are killed after ~30s of inactivity.
// We ping the offscreen document every 20s to keep both alive.

let heartbeatInterval = null;

export function startHeartbeat() {
  if (heartbeatInterval) return;

  heartbeatInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'HEARTBEAT' }).catch(() => {
      // Offscreen doc may have been killed — will be recreated on next action
    });
  }, 20_000);
}

export function stopHeartbeat() {
  if (!heartbeatInterval) return;
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}
