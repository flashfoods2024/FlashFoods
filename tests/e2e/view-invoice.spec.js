import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";

const ROOT = path.resolve(process.cwd());
const fixture = JSON.parse(
  fs.readFileSync(path.join(ROOT, "temp", "qa-billing-fixture.json"), "utf8"),
);
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

// The two student phone widths the invoice card must work at.
const VIEWPORTS = [
  { name: "393x852", width: 393, height: 852 },
  { name: "414x896", width: 414, height: 896 },
];

async function login(page, email, password) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click("button[type=submit]"),
  ]);
}

async function waitForInvoiceCard(page) {
  await page.waitForFunction(
    () => {
      const els = [...document.querySelectorAll("h2")].map((el) => el.textContent);
      return els.includes("Your Invoice");
    },
    { timeout: 15_000 },
  );
}

test("student order detail shows view/download invoice actions when an invoice exists", async ({
  browser,
}) => {
  const orderId = fixture.completedOrderId;
  let invoiceSha = null;

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    try {
      await login(page, fixture.studentEmail, fixture.password);

      // Reuse an already-issued, completed order from the isolated QA fixture.
      await page.goto(`/orders/${orderId}`);
      await waitForInvoiceCard(page);

      await expect(page.locator("h2", { hasText: "Your Invoice" })).toBeVisible();
      await expect(
        page.locator("text=Your order invoice is ready. View or download your bill."),
      ).toBeVisible();

      const view = page.locator('a[href$="/invoice"]:has-text("View Invoice")');
      await expect(view).toHaveCount(1);
      await expect(view).toHaveText("View Invoice");

      const download = page.locator('a[href$="/invoice?download=1"][download]');
      await expect(download).toHaveCount(1);
      await expect(download).toHaveText("Download PDF");
      await expect(download).toHaveAttribute(
        "href",
        `/orders/${orderId}/invoice?download=1`,
      );

      // Touch targets and layout at this exact phone width.
      for (const target of [view, download]) {
        const box = await target.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      // The bottom navigation must still work from the invoice card.
      const bottomNav = page.locator("nav.bottom-nav");
      await expect(bottomNav).toBeVisible();
      await bottomNav.locator('a[href="/orders"]').click();
      await page.waitForURL("**/orders");

      if (!invoiceSha) {
        await page.goto(`/orders/${orderId}`);
        // The two actions must return byte-identical invoice content.
        const [viewResponse, downloadResponse] = await Promise.all([
          page.request.get(`/orders/${orderId}/invoice`),
          page.request.get(`/orders/${orderId}/invoice?download=1`),
        ]);
        expect(viewResponse.status()).toBe(200);
        expect(downloadResponse.status()).toBe(200);
        expect(viewResponse.headers()["content-type"]).toContain("application/pdf");
        expect(viewResponse.headers()["content-disposition"]).toContain("inline");
        expect(downloadResponse.headers()["content-disposition"]).toContain("attachment");
        const viewBytes = await viewResponse.body();
        const downloadBytes = await downloadResponse.body();
        expect(sha256(viewBytes)).toBe(sha256(downloadBytes));
        expect(viewBytes.length).toBe(downloadBytes.length);

        const invoicePath = path.join(
          ROOT,
          "temp",
          "billing-e2e",
          `view-invoice-${viewport.name}.pdf`,
        );
        fs.mkdirSync(path.dirname(invoicePath), { recursive: true });
        fs.writeFileSync(invoicePath, viewBytes);
        const pdfDoc = await PDFDocument.load(viewBytes);
        expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(1);

        invoiceSha = sha256(viewBytes);
        for (let i = 0; i < 3; i += 1) {
          const again = await page.request.get(`/orders/${orderId}/invoice`);
          expect(sha256(await again.body())).toBe(invoiceSha);
        }
      } else {
        // A repeated click on the second viewport must not issue a new invoice.
        const again = await page.request.get(`/orders/${orderId}/invoice`);
        expect(again.status()).toBe(200);
        expect(sha256(await again.body())).toBe(invoiceSha);
      }
    } finally {
      await context.close();
    }
  }
});

test("student order detail hides the invoice card when there is no invoice", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const plainPage = await context.newPage();
  try {
    await login(plainPage, fixture.studentEmail, fixture.password);
    await plainPage.goto(`/orders/${fixture.plainOrderId}`);
    await expect(
      plainPage.locator("h2", { hasText: "Your Invoice" }),
    ).not.toBeVisible();
    await expect(plainPage.locator("text=Download PDF")).not.toBeVisible();
  } finally {
    await context.close();
  }
});

test("a different student cannot reach another student's invoice", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const another = await context.newPage();
  try {
    await login(another, fixture.otherStudentEmail, fixture.password);
    const response = await another.request.get(
      `/orders/${fixture.completedOrderId}/invoice`,
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(302);
  } finally {
    await context.close();
  }
});
