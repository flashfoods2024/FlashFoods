import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * End-to-end proof for the custom PDF overlay billing system.
 *
 * Runs only against scripts/qa-billing-server.mjs (in-memory Mongo, local
 * storage under temp/, real "Testing" shop so the application's own mock
 * checkout gate applies). No production database, gateway, notification or
 * Cloudinary call is involved.
 */

const ROOT = path.resolve(process.cwd());
const ARTIFACTS = path.join(ROOT, "temp", "billing-e2e");
const fixture = JSON.parse(
  fs.readFileSync(path.join(ROOT, "temp", "qa-billing-fixture.json"), "utf8"),
);

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

async function writeCleanTemplate(fileName, label) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("TESTING CANTEEN", { x: 48, y: 792, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("GSTIN: 00AAAAA0000A1Z5", { x: 48, y: 774, size: 9, font });
  page.drawText("Tax Invoice", { x: 470, y: 792, size: 12, font });
  // Clean master: labels sit on the left, the value areas used by the default
  // field mapping are left blank (no printed underscores to collide with).
  page.drawText("Invoice No:", { x: 48, y: 760, size: 9, font });
  page.drawText("Date:", { x: 48, y: 744, size: 9, font });
  page.drawText("Bill To:", { x: 48, y: 720, size: 9, font });
  page.drawText("Item", { x: 48, y: 590, size: 9, font });
  page.drawText("Qty", { x: 320, y: 590, size: 9, font });
  page.drawText("Rate", { x: 370, y: 590, size: 9, font });
  page.drawText("Amount", { x: 450, y: 590, size: 9, font });
  page.drawText("Subtotal:", { x: 330, y: 260, size: 9, font });
  page.drawText("Discount:", { x: 330, y: 244, size: 9, font });
  page.drawText("Parcel:", { x: 330, y: 228, size: 9, font });
  page.drawText("Total:", { x: 330, y: 200, size: 11, font });
  page.drawText(label, { x: 48, y: 60, size: 8, font });
  const bytes = Buffer.from(await doc.save());
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, fileName), bytes);
  return bytes;
}

function pdfText(filePath) {
  return execFileSync("pdftotext", [filePath, "-"], { encoding: "utf8" });
}

async function login(page, email, password) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click("button[type=submit]"),
  ]);
}

async function waitForCanvas(page) {
  await page.waitForFunction(() => {
    const canvas = document.getElementById("billing-canvas");
    if (!canvas || !canvas.width) return false;
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, Math.min(40, canvas.width), Math.min(40, canvas.height)).data;
    return data.some((value) => value !== 0);
  });
}

async function uploadTemplate(page, formSelector, name, buffer) {
  await page.setInputFiles(`${formSelector} input[name=template]`, {
    name,
    mimeType: "application/pdf",
    buffer,
  });
  const [response] = await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click(`${formSelector} button[type=submit]`),
  ]);
  return response;
}

const post = (api, url, data = {}) =>
  api.post(url, { form: data, maxRedirects: 0, headers: { Accept: "text/html" } });

const placeOrder = async (api, menuItemId) => {
  const added = await post(api, "/cart/add", { menuItemId, quantity: "1" });
  expect(added.status()).toBeLessThan(400);
  const checkout = await post(api, "/orders/checkout", { orderType: "dinein" });
  expect(checkout.status()).toBe(302);
  return new URL(checkout.headers().location, fixture.baseUrl).pathname.split("/").pop();
};

test.describe.serial("custom billing template on the Testing shop", () => {
  test("vendor configures, sample renders, eligible order is invoiced, fallbacks hold", async ({
    browser,
  }) => {
    const pageErrors = [];
    const vendorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const vendorPage = await vendorContext.newPage();
    vendorPage.on("pageerror", (error) =>
      pageErrors.push({ page: "vendor", message: error.message, stack: error.stack }),
    );

    // 1. Vendor authentication and card placement.
    await login(vendorPage, fixture.vendorEmail, fixture.password);
    await vendorPage.goto("/vendor/menu");
    const menuText = await vendorPage.locator("main").innerText();
    const pickupIdx = menuText.indexOf("Pickup Slots");
    const billingIdx = menuText.indexOf("Billing Template");
    const hoursIdx = menuText.indexOf("Operating Hours");
    expect(pickupIdx).toBeGreaterThan(-1);
    expect(billingIdx).toBeGreaterThan(pickupIdx);
    if (hoursIdx > -1) expect(billingIdx).toBeLessThan(hoursIdx);

    // 2. Upload the clean master PDF through the card.
    const templateOne = await writeCleanTemplate("clean-template.pdf", "master template v1");
    const uploadResponse = await uploadTemplate(
      vendorPage,
      "#billing-template-card form",
      "clean-template.pdf",
      templateOne,
    );
    expect(uploadResponse.status()).toBeLessThan(400);
    await expect(vendorPage.locator(".flash--success")).toContainText("Invoice PDF uploaded");

    // 3. PDF.js preview must actually paint the vendor's document.
    await vendorPage.goto("/vendor/menu/billing-template");
    await waitForCanvas(vendorPage);
    const canvasSize = await vendorPage.evaluate(() => {
      const canvas = document.getElementById("billing-canvas");
      return { width: canvas.width, height: canvas.height };
    });
    expect(canvasSize.width).toBeGreaterThan(100);

    // 4. Configure field positions and the item table, save, reload, verify persistence.
    await vendorPage.click("#billing-defaults");
    const [saveRequest, saveResponse] = await Promise.all([
      vendorPage.waitForRequest((request) => request.url().endsWith("/mapping")),
      vendorPage.waitForResponse((response) => response.url().endsWith("/mapping")),
      vendorPage.click("#billing-save"),
    ]);
    const savePayload = saveRequest.postDataJSON();
    const saveResult = await saveResponse.json();
    await expect(vendorPage.locator("#billing-feedback")).toContainText("Field positions saved.");
    await vendorPage.reload();
    await waitForCanvas(vendorPage);
    // PDF.js paints before its render promise resolves, so the editor's field
    // list appears a moment after the canvas. Wait for the rendered table info
    // (auto-retrying) instead of sampling the list too early.
    await expect(vendorPage.locator("#billing-table-info")).toContainText("Table at");
    const placedFields = await vendorPage.locator("#billing-field-list li").count();
    expect(placedFields).toBeGreaterThanOrEqual(6);
    expect(saveResult.ok).toBe(true);
    expect(Object.keys(savePayload.mapping.fields).length).toBeGreaterThanOrEqual(6);

    // 4b. Selecting a placed field edits that exact field, and an impossible box
    // is reported by name instead of a generic "a value is too long".
    await vendorPage.selectOption("#billing-field-select", "amountInWords");
    await expect(vendorPage.locator("#billing-maxlines")).toHaveValue("3");
    await vendorPage.fill("#billing-maxwidth", "180");
    await vendorPage.fill("#billing-maxlines", "1");
    const [narrowRequest, narrowResponse] = await Promise.all([
      vendorPage.waitForRequest((request) => request.url().endsWith("/mapping")),
      vendorPage.waitForResponse((response) => response.url().endsWith("/mapping")),
      vendorPage.click("#billing-save"),
    ]);
    expect((await narrowResponse.json()).ok).toBe(true);
    expect(narrowRequest.postDataJSON().mapping.fields.amountInWords.maxWidth).toBe(180);
    expect(narrowRequest.postDataJSON().mapping.fields.amountInWords.maxLines).toBe(1);

    await vendorPage.click("#billing-preview");
    await expect(vendorPage.locator("#billing-feedback")).toContainText("Amount in words");
    await expect(vendorPage.locator("#billing-feedback")).toContainText("2 lines");
    await expect(vendorPage.locator("#billing-field-list li.is-error")).toContainText(
      "Amount in words",
    );

    // 4c. Correcting the same field in place must succeed without losing the
    // other configured positions.
    await vendorPage.fill("#billing-maxwidth", "460");
    await vendorPage.fill("#billing-maxlines", "3");
    await expect(vendorPage.locator("#billing-field-list")).toContainText("3 lines");
    await expect(vendorPage.locator("#billing-field-list li")).toHaveCount(placedFields);

    // 5. Sample invoice (same generator, sample mode), then visual/text checks.
    const config = JSON.parse(await vendorPage.locator("#billing-config").innerText());
    const versionId = config.versionId;
    expect(versionId).toHaveLength(24);

    await vendorPage.click("#billing-preview");
    await expect(vendorPage.locator("#billing-feedback")).toContainText(
      "Sample invoice generated",
    );

    const sampleResponse = await vendorContext.request.get(
      `/vendor/menu/billing-template/sample.pdf?version=${versionId}`,
    );
    expect(sampleResponse.status()).toBe(200);
    expect(sampleResponse.headers()["content-type"]).toContain("application/pdf");
    expect(sampleResponse.headers()["cache-control"]).toContain("no-store");
    const sampleBytes = await sampleResponse.body();
    const samplePath = path.join(ARTIFACTS, "sample-invoice.pdf");
    fs.writeFileSync(samplePath, sampleBytes);
    expect(sampleBytes.subarray(0, 5).toString()).toBe("%PDF-");
    execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", samplePath, path.join(ARTIFACTS, "sample-page")]);

    // 6. Activate the template.
    await vendorPage.click("#billing-activate");
    await vendorPage.waitForFunction(
      () => document.body.innerText.includes("Active template v"),
      null,
      { timeout: 20_000 },
    );

    // 7. Student places an order with the application's restricted mock checkout.
    const studentContext = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const studentPage = await studentContext.newPage();
    studentPage.on("pageerror", (error) =>
      pageErrors.push({ page: "student", message: error.message, stack: error.stack }),
    );
    await login(studentPage, fixture.studentEmail, fixture.password);
    const studentApi = studentContext.request;
    const orderId = await placeOrder(studentApi, fixture.menuItemIds[0]);

    await studentPage.goto(`/orders/${orderId}`);
    await expect(studentPage.locator("h2", { hasText: "Items" })).toBeVisible();
    await expect(studentPage.locator("text=QA Burger")).toBeVisible();
    await expect(studentPage.locator('a[href$="/invoice"]')).toHaveCount(0);

    // 8. Vendor accepts, prepares, and completes pickup with the OTP path.
    const vendorApi = vendorContext.request;
    expect((await post(vendorApi, `/vendor/orders/${orderId}/accept`)).status()).toBe(302);
    expect((await post(vendorApi, `/vendor/orders/${orderId}/ready`)).status()).toBe(302);

    await studentPage.reload();
    const otp = (await studentPage.locator(".otp-box__code").innerText()).replace(/\D/g, "");
    expect(otp).toHaveLength(6);
    await expect(studentPage.locator('a[href$="/invoice"]')).toHaveCount(0);
    expect((await post(vendorApi, "/vendor/verify", { otp })).status()).toBe(302);

    // 9. Invoice is issued once and the existing order page gains the action.
    await studentPage.reload();
    const invoiceLink = studentPage.locator('a[href$="/invoice"]');
    await expect(invoiceLink).toHaveCount(1);
    await expect(invoiceLink).toContainText("Download invoice");
    const target = await invoiceLink.boundingBox();
    expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
    const horizontalOverflow = await studentPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    const invoiceResponse = await studentApi.get(`/orders/${orderId}/invoice`);
    expect(invoiceResponse.status()).toBe(200);
    expect(invoiceResponse.headers()["content-type"]).toContain("application/pdf");
    expect(invoiceResponse.headers()["cache-control"]).toContain("no-store");
    expect(invoiceResponse.headers()["x-content-type-options"]).toBe("nosniff");
    const invoiceBytes = await invoiceResponse.body();
    const invoicePath = path.join(ARTIFACTS, "order-invoice.pdf");
    fs.writeFileSync(invoicePath, invoiceBytes);
    const invoiceText = pdfText(invoicePath);
    expect(invoiceText).toContain("QA Burger");
    expect(invoiceText).toMatch(/INV-testing-\d{6}/);

    // 10. Repeat requests return identical bytes and one invoice record.
    const invoiceSha = sha256(invoiceBytes);
    for (let i = 0; i < 3; i += 1) {
      const again = await studentApi.get(`/orders/${orderId}/invoice`);
      expect(again.status()).toBe(200);
      expect(sha256(await again.body())).toBe(invoiceSha);
    }
    await vendorPage.goto("/vendor/menu");
    await expect(vendorPage.locator("#billing-template-card")).toContainText("1 invoice(s) issued");

    // 11. Replacing the template must not change historical invoices.
    const templateTwo = await writeCleanTemplate("clean-template-v2.pdf", "master template v2");
    await vendorPage.goto("/vendor/menu/billing-template");
    const replaceResponse = await uploadTemplate(
      vendorPage,
      'form[action$="/upload"]',
      "clean-template-v2.pdf",
      templateTwo,
    );
    expect(replaceResponse.status()).toBeLessThan(400);
    const unchanged = await studentApi.get(`/orders/${orderId}/invoice`);
    expect(sha256(await unchanged.body())).toBe(invoiceSha);

    // 12. Removal keeps issued invoices and makes new orders use the default bill.
    expect(
      (await post(vendorApi, "/vendor/menu/billing-template/remove")).status(),
    ).toBe(302);
    const stillThere = await studentApi.get(`/orders/${orderId}/invoice`);
    expect(stillThere.status()).toBe(200);
    expect(sha256(await stillThere.body())).toBe(invoiceSha);

    const secondOrderId = await placeOrder(studentApi, fixture.menuItemIds[1]);
    expect((await post(vendorApi, `/vendor/orders/${secondOrderId}/accept`)).status()).toBe(302);
    expect((await post(vendorApi, `/vendor/orders/${secondOrderId}/ready`)).status()).toBe(302);
    await studentPage.goto(`/orders/${secondOrderId}`);
    const secondOtp = (await studentPage.locator(".otp-box__code").innerText()).replace(/\D/g, "");
    expect((await post(vendorApi, "/vendor/verify", { otp: secondOtp })).status()).toBe(302);

    await studentPage.goto(`/orders/${secondOrderId}`);
    await expect(studentPage.locator("text=QA Coffee")).toBeVisible();
    await expect(studentPage.locator('a[href$="/invoice"]')).toHaveCount(0);
    const refused = await studentApi.get(`/orders/${secondOrderId}/invoice`, {
      maxRedirects: 0,
    });
    expect(refused.status()).toBe(302);

    // 13. Role boundaries stay enforced.
    const studentUpload = await studentApi.post("/vendor/menu/billing-template/upload", {
      multipart: { template: { name: "x.pdf", mimeType: "application/pdf", buffer: templateOne } },
      maxRedirects: 0,
    });
    expect(studentUpload.status()).toBe(302);
    const rival = await browser.newContext();
    const rivalPage = await rival.newPage();
    await login(rivalPage, fixture.vendor2Email, fixture.password);
    const foreign = await rival.request.get(
      `/vendor/menu/billing-template/file?version=${versionId}`,
      { maxRedirects: 0 },
    );
    expect(foreign.status()).toBe(302);

    // 14. A shop that never uploaded a template keeps the default bill.
    const plainPage = await studentContext.newPage();
    await plainPage.goto(`/orders/${fixture.plainOrderId}`);
    await expect(plainPage.locator("text=Plain Item")).toBeVisible();
    await expect(plainPage.locator('a[href$="/invoice"]')).toHaveCount(0);

    // 15. Uploaded-but-unconfigured template also keeps the default bill.
    const plainVendorContext = await browser.newContext();
    const plainVendorPage = await plainVendorContext.newPage();
    await login(plainVendorPage, fixture.plainVendorEmail, fixture.password);
    await plainVendorPage.goto("/vendor/menu");
    await uploadTemplate(
      plainVendorPage,
      "#billing-template-card form",
      "plain-template.pdf",
      templateOne,
    );
    await expect(plainVendorPage.locator("#billing-template-card")).toContainText(
      "Uploaded — configure fields",
    );
    await plainPage.reload();
    await expect(plainPage.locator('a[href$="/invoice"]')).toHaveCount(0);
    const plainInvoice = await studentApi.get(`/orders/${fixture.plainOrderId}/invoice`, {
      maxRedirects: 0,
    });
    expect(plainInvoice.status()).toBe(302);

    expect(pageErrors).toEqual([]);
    fs.writeFileSync(
      path.join(ARTIFACTS, "e2e-summary.json"),
      JSON.stringify(
        {
          versionId,
          orderId,
          invoiceSha256: invoiceSha,
          invoiceBytes: invoiceBytes.length,
          sampleBytes: sampleBytes.length,
          placedFields,
          secondOrderId,
        },
        null,
        2,
      ),
    );

    await studentContext.close();
    await vendorContext.close();
    await rival.close();
    await plainVendorContext.close();
  });
});
