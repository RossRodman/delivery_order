import { expect, test } from "@playwright/test";
import { addProduct, loginAs, selectDealer, setLineQtyAndDiscount } from "./helpers";

test.describe.configure({ mode: "serial" });

async function waitForServiceWorkerControl(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => "serviceWorker" in navigator && navigator.serviceWorker.controller !== null, {
    timeout: 20_000,
  });
}

test("AC7 — offline order syncs and appears as saved on reconnect", async ({ page, context }) => {
  await loginAs(page, "adviser");

  // Visit /orders and /order online first (runtime cache, plan.md §8.1) and wait for the
  // service worker to actually control the page before going offline.
  await page.goto("/orders");
  await waitForServiceWorkerControl(page);

  const orderId = crypto.randomUUID();
  await page.goto(`/order?id=${orderId}`);
  await expect(page.locator("#dealer-picker")).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText("You're offline")).toBeVisible();
  await expect(page.locator("#dealer-picker")).toBeVisible();

  await selectDealer(page, "Al-Noor Trading");
  await addProduct(page, "Water pump");
  await setLineQtyAndDiscount(page, "Water pump", 4, 40);

  await expect(page.getByRole("button", { name: "Save (offline)" })).toBeVisible();
  await page.getByRole("button", { name: "Save (offline)" }).click();

  await expect(page.getByText("Queued")).toBeVisible();

  await context.setOffline(false);

  await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("totals-sdg")).toHaveText("16,564,000 SDG");
});

test("AC7 — an offline save the server rejects surfaces on the order", async ({ page, context, browser }) => {
  await loginAs(page, "adviser");
  await page.goto("/orders");
  await waitForServiceWorkerControl(page);

  const orderId = crypto.randomUUID();
  await page.goto(`/order?id=${orderId}`);
  await selectDealer(page, "Al-Noor Trading");
  await addProduct(page, "Battery");
  // $90 on the cached $2,070 price is 4.35% (red, saveable). The owner will lower the price
  // offline so the same dollar discount becomes > 5% (blocked) by the time the sync replays it.
  await setLineQtyAndDiscount(page, "Battery", 1, 90);
  await page.waitForTimeout(1000); // let the autosave PUT create the draft row before going offline

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("You're offline")).toBeVisible();

  // Owner lowers the Battery price while the adviser is offline.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await loginAs(ownerPage, "owner");
  await ownerPage.goto("/settings");
  const batteryRow = ownerPage.getByTestId("price-row-BATT-03");
  await batteryRow.getByRole("button", { name: "Edit" }).click();
  await ownerPage.getByLabel("Battery price").fill("1000");
  await ownerPage.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ownerPage.getByText("Price updated.")).toBeVisible();
  await ownerContext.close();

  await page.getByRole("button", { name: "Save (offline)" }).click();
  await expect(page.getByText("Queued")).toBeVisible();

  await context.setOffline(false);

  // $90 on the new $1,000 price is 9% — blocked and unapproved, so the server refuses the save.
  // The order must become editable again with the refusal surfaced, never silently dropped.
  await expect(page.getByText("Queued")).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Save order" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Couldn't save/)).toBeVisible();
  // The line itself is still there (nothing silently dropped) — the client still shows its own
  // cached price/classification until the catalog is refreshed; the refusal is what proves the
  // server re-validated with its own (now lower) price.
  await expect(page.getByText("Battery")).toBeVisible();
});
