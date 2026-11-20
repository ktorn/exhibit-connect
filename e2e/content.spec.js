import { test, expect } from "@playwright/test";

const PREFIX = "/__exhibit-connect/v1";

test.describe("per-device content API", () => {
  test("manager page loads and status lists content capability", async ({ page, request }) => {
    const status = await request.get(`${PREFIX}/status`);
    expect(status.ok()).toBeTruthy();
    const body = await status.json();
    expect(body.capabilities).toContain("content");
    expect(body.role).toBe("host");

    await page.goto(`${PREFIX}/manager`);
    await expect(page.getByRole("heading", { name: "Exhibit signage" })).toBeVisible();
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.locator("#status")).toContainText("Connected");
  });

  test("can pin a URL as current content", async ({ request }) => {
    const add = await request.post(`${PREFIX}/content/urls`, {
      data: { url: "http://127.0.0.1:8899/index.html", name: "display" },
    });
    expect(add.status()).toBe(201);
    const listed = await request.get(`${PREFIX}/content`);
    const body = await listed.json();
    expect(body.current.url).toBe("http://127.0.0.1:8899/index.html");
  });
});
