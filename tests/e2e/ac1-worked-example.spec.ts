import { expect, test } from "@playwright/test";
import { addProduct, loginAs, selectDealer, setLineQtyAndDiscount } from "./helpers";

test("AC1 — worked example reproduces spec.md exactly", async ({ page, browser }) => {
  await loginAs(page, "adviser");

  // ---- Two lines (sand + red), no blocked line: saves immediately. ----
  await page.getByRole("link", { name: "+ New order" }).first().click();
  await expect(page).toHaveURL(/\/order\?id=/);

  await selectDealer(page, "Al-Noor Trading");
  await addProduct(page, "Water pump");
  await setLineQtyAndDiscount(page, "Water pump", 4, 40);
  await addProduct(page, "Filter");
  await setLineQtyAndDiscount(page, "Filter", 2, 70);

  await expect(page.getByText("1.94%")).toBeVisible();
  await expect(page.getByText("OK")).toBeVisible();
  await expect(page.getByText("4.32%")).toBeVisible();
  await expect(page.getByText("Warning")).toBeVisible();
  await expect(page.getByTestId("totals-sdg")).toHaveText("29,274,000 SDG");
  await expect(page.getByRole("button", { name: "Save order" })).toBeEnabled();

  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByText(/Saved/)).toBeVisible();
  await expect(page.getByTestId("totals-sdg")).toHaveText("29,274,000 SDG");

  // ---- Second order: add the 7.25% line, request approval, owner approves, then save. ----
  await page.goto("/orders");
  await page.getByRole("link", { name: "+ New order" }).first().click();
  await expect(page).toHaveURL(/\/order\?id=/);

  await selectDealer(page, "Al-Noor Trading");
  await addProduct(page, "Water pump");
  await setLineQtyAndDiscount(page, "Water pump", 4, 40);
  await addProduct(page, "Filter");
  await setLineQtyAndDiscount(page, "Filter", 2, 70);
  await addProduct(page, "Battery");
  await setLineQtyAndDiscount(page, "Battery", 1, 150);

  await expect(page.getByText("7.25%")).toBeVisible();
  await expect(page.getByText("Blocked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save order" })).toBeDisabled();
  await expect(page.getByTestId("totals-sdg")).toHaveText("45,018,000 SDG");

  const orderId = new URL(page.url()).searchParams.get("id");
  expect(orderId).toBeTruthy();

  await page.getByRole("button", { name: "Request approval" }).click();
  await expect(page.getByText("Pending approval")).toBeVisible();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await loginAs(ownerPage, "owner");
  await ownerPage.goto(`/approvals/${orderId}`);
  await ownerPage.getByRole("button", { name: "Approve" }).click();
  await expect(ownerPage.getByText("All lines decided")).toBeVisible();
  await ownerContext.close();

  await page.reload();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save order" })).toBeEnabled();
  await page.getByRole("button", { name: "Save order" }).click();

  await expect(page.getByText(/Saved/)).toBeVisible();
  await expect(page.getByTestId("totals-sdg")).toHaveText("45,018,000 SDG");
  await expect(page.getByText("$5,490")).toBeVisible();
});
