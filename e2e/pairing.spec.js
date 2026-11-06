import { test, expect } from "@playwright/test";
import dgram from "node:dgram";
import { decodeBeacon } from "@exhibit-connect/core";

const PREFIX = "/__exhibit-connect/v1";

async function listenOneBeacon(port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timed out waiting for UDP beacon"));
    }, timeoutMs);
    socket.on("message", (msg) => {
      const payload = decodeBeacon(msg.toString("utf8"));
      if (!payload) return;
      clearTimeout(timer);
      socket.close();
      resolve(payload);
    });
    socket.bind(port);
  });
}

test.describe.serial("invisible violence pairing", () => {
  test("udp beacon is discovery before pair", async ({ request }) => {
    const status = await request.get(`${PREFIX}/status`);
    expect(status.ok()).toBeTruthy();
    const body = await status.json();
    expect(body.discoveryEnabled).toBe(true);
    expect(body.paired).toBe(false);

    const beacon = await listenOneBeacon(41299);
    expect(beacon.mode).toBe("discovery");
    expect(beacon.exhibitId).toBe("invisible-violence-2026");
    expect(beacon.httpBase).toBe("http://127.0.0.1:8899");
  });

  test("projection overlay + tablet confirm + last-IP reconnect", async ({ browser }) => {
    const projection = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const tablet = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const projPage = await projection.newPage();
    const tabPage = await tablet.newPage();

    await projPage.goto("/index.html");
    await tabPage.goto("/tablet-pair.html");

    await expect(tabPage.getByRole("button", { name: /Invisible Violence/ })).toBeVisible();
    await tabPage.getByRole("button", { name: /Invisible Violence/ }).click();
    await expect(tabPage.getByText("Enter the code shown on the main projection.")).toBeVisible();

    const overlay = projPage.locator("[data-exhibit-connect-overlay]");
    await expect(overlay).toHaveCSS("display", "flex");
    const code = (await projPage.locator("[data-exhibit-connect-code]").textContent())?.replace(/\s/g, "") ?? "";
    expect(code).toMatch(/^\d{6}$/);

    await tabPage.locator("#code").fill(code);
    await tabPage.locator("#confirm").click();
    await expect(tabPage).toHaveURL(/controller\.html/);
    await expect(tabPage.locator("#click-btn")).toBeVisible();

    await expect(overlay).toHaveCSS("display", "none");

    const status = await projPage.request.get(`${PREFIX}/status`);
    const body = await status.json();
    expect(body.paired).toBe(true);
    expect(body.tabletConnected).toBe(true);
    expect(body.discoveryEnabled).toBe(false);

    await tabPage.goto("/tablet-pair.html");
    await expect(tabPage).toHaveURL(/controller\.html/);

    const stored = await tabPage.evaluate(() =>
      JSON.parse(localStorage.getItem("exhibit-connect-pairing-v1") || "{}"),
    );
    expect(stored.lastHttpBase).toBe("http://127.0.0.1:8899");

    await tabPage.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("exhibit-connect-pairing-v1") || "{}");
      raw.lastHttpBase = "http://127.0.0.1:1";
      raw.pairingBase = "http://127.0.0.1:1";
      localStorage.setItem("exhibit-connect-pairing-v1", JSON.stringify(raw));
    });
    await tabPage.goto("/tablet-pair.html");
    await expect(tabPage).toHaveURL(/controller\.html/);

    await projection.close();
    await tablet.close();
  });

  test("second tablet cannot pair while first is bound", async ({ request }) => {
    const res = await request.post(`${PREFIX}/pair/start`, {
      data: { tabletId: "other-tablet" },
    });
    expect(res.status()).toBe(409);
  });
});
