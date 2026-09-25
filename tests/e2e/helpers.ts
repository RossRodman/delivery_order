import { expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, role: "adviser" | "owner"): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(role, "i") }).click();
  await expect(page).toHaveURL(/\/orders/);
}

/** Opens the product picker, selects the option whose value maps to `label`, and adds it. */
export async function addProduct(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "+ Add product" }).first().click();
  const select = page.getByLabel("Select a product");
  const optionValue = await select
    .locator("option")
    .filter({ hasText: label })
    .first()
    .getAttribute("value");
  if (!optionValue) throw new Error(`No product option matching "${label}"`);
  await select.selectOption(optionValue);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

export async function selectDealer(page: Page, name: string): Promise<void> {
  await page.locator("#dealer-picker").selectOption({ label: name });
}

export async function setLineQtyAndDiscount(page: Page, rowText: string, qty: number, discount: number): Promise<void> {
  const row = page.locator("tr", { hasText: rowText }).first();
  await row.getByLabel("Qty").fill(String(qty));
  await row.getByLabel("Discount $").fill(String(discount));
  await row.getByLabel("Discount $").blur();
}
