/**
 * Simple SSE fan-out for projection displays.
 */
export function createProjectionHub() {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();

  function subscribe(res) {
    clients.add(res);
    res.on("close", () => clients.delete(res));
  }

  /**
   * @param {string} event
   * @param {unknown} data
   */
  function emit(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      res.write(payload);
    }
  }

  return { subscribe, emit };
}
