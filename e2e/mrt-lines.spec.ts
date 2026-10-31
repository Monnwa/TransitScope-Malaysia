import { expect, test } from "@playwright/test";

test("MRT line and shared station selection highlights the right alignments", async ({ page }) => {
  // Synthetic browser fixtures isolate interactions from external feed availability.
  const base = { mode: "MRT", operator: "Test fixture", route: "MRT Kajang Line (MRT1) · MRT Putrajaya Line (MRT2)", station: "TRX", position: [3.142403, 101.720156], dataMode: "STATIC", status: "Station available", source: "Test fixture", recordKind: "stop", reportedAt: null, interchange: true, mrtLines: ["MRT1", "MRT2"] };
  await page.route("**/api/transit?*", route => route.fulfill({ json: { records: [{ ...base, id: "trx-test", name: "TRX" }], alerts: [], feeds: [], fetchedAt: new Date().toISOString(), demo: false } }));
  await page.route("**/api/mrt-lines", route => route.fulfill({ json: { available: true, lines: [
    { id: "MRT1", name: "MRT Kajang Line (MRT1)", colour: "#006B3F", paths: [[[3.14, 101.70], [3.142403, 101.720156]]], dataMode: "STATIC" },
    { id: "MRT2", name: "MRT Putrajaya Line (MRT2)", colour: "#F2C500", paths: [[[3.16, 101.72], [3.142403, 101.720156]]], dataMode: "STATIC" },
  ] } }));
  await page.goto("/");
  const kajang = page.getByRole("button", { name: "MRT Kajang Line (MRT1)" });
  const putrajaya = page.getByRole("button", { name: "MRT Putrajaya Line (MRT2)" });
  await expect(page.locator(".mrt-alignment")).toHaveCount(2);
  await kajang.click(); await expect(kajang).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".mrt-alignment.MRT2")).toHaveAttribute("stroke-opacity", "0.3");
  await page.locator(".mrt-alignment.MRT2").dispatchEvent("click");
  await expect(putrajaya).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "View details" }).click();
  await expect(kajang).toHaveAttribute("aria-pressed", "true"); await expect(putrajaya).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Selected transport detail")).toContainText("serves both MRT lines");
  await kajang.click();
  await page.locator('.leaflet-marker-icon[title="TRX"]').click();
  await expect(putrajaya).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.leaflet-popup-content').filter({ hasText: "TRX" })).toContainText("Interchange for both MRT lines");
});

test("MRT geometry failure leaves stations available with a clear fallback", async ({ page }) => {
  await page.route("**/api/mrt-lines", route => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/?mode=demo");
  await expect(page.getByRole("status").filter({ hasText: "MRT railway alignment unavailable" })).toBeVisible();
  await expect(page.locator("tbody")).toContainText("Bukit Bintang station");
});
