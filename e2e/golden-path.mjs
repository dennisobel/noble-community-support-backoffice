import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Golden-path browser check. Needs the API and the web app running against an EMPTY database (see README).
 *   pnpm test:e2e            (E2E_BROWSER=chrome | msedge, BASE_URL, MAILPIT_URL)
 */
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8125";
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "screenshots"
);
fs.mkdirSync(OUT, { recursive: true });

const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
);

const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER ?? "chrome",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  permissions: ["microphone"],
});
const page = await context.newPage();
const problems = [];
page.on("console", message => {
  if (
    message.type() === "error" &&
    !message.text().includes("401 (Unauthorized)")
  )
    problems.push(`console: ${message.text()}`);
});
page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
page.on("response", response => {
  const url = response.url();
  if (url.includes("/api/") && response.status() >= 500)
    problems.push(
      `HTTP ${response.status()} ${response.request().method()} ${url}`
    );
});

let step = 0;
const results = [];
async function run(name, fn) {
  step += 1;
  const label = `${String(step).padStart(2, "0")}-${name}`;
  try {
    await fn();
    await page.screenshot({
      path: path.join(OUT, `${label}.png`),
      fullPage: false,
    });
    results.push(`PASS ${label}`);
  } catch (error) {
    await page
      .screenshot({
        path: path.join(OUT, `${label}-FAILED.png`),
        fullPage: true,
      })
      .catch(() => undefined);
    results.push(`FAIL ${label}: ${error.message.split("\n")[0]}`);
    throw error;
  }
}
const toast = async text =>
  page
    .locator(".toast")
    .filter({ hasText: text })
    .first()
    .waitFor({ timeout: 10_000 });

try {
  await run("landing", async () => {
    await page.goto(BASE);
    await page
      .getByRole("heading", { name: /Support that makes room/ })
      .waitFor();
    await page.getByRole("button", { name: "Set up the workspace" }).click();
    await page.waitForURL("**/signup");
  });

  await run("signup", async () => {
    await page.getByPlaceholder("Your name").fill("Maya Thompson");
    await page
      .getByPlaceholder("name@organisation.org.au")
      .fill("maya@noble.test");
    await page.getByPlaceholder("At least 8 characters").fill("short");
    await page.getByPlaceholder("Enter password again").fill("short");
    await page.getByRole("button", { name: "Create Admin account" }).click();
    await page
      .getByText("Choose a password with at least 8 characters.")
      .waitFor();
    await page
      .getByPlaceholder("At least 8 characters")
      .fill("correct horse battery");
    await page
      .getByPlaceholder("Enter password again")
      .fill("correct horse battery");
    await page.getByRole("button", { name: "Create Admin account" }).click();
    await page.waitForURL("**/app/settings/workspace");
    await page.getByRole("heading", { name: "Settings" }).waitFor();
  });

  await run("workspace-settings", async () => {
    await page.getByLabel("Legal name").fill("Noble Community Support Pty Ltd");
    await page.getByLabel("ABN").fill("12 345 678 901");
    await page.getByRole("button", { name: "Save workspace settings" }).click();
    await toast("Workspace settings saved.");
  });

  await run("services", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Services", exact: true })
      .click();
    for (const [name, rate, category] of [
      ["Community participation", "68.30", "Community participation"],
      ["Daily living skills", "68.30", "Daily living skills"],
    ]) {
      await page.getByRole("button", { name: "Add service" }).click();
      await page.locator("#new-service-name").fill(name);
      await page.locator("#new-service-rate").fill(rate);
      await page.locator("#new-service-category").selectOption(category);
      await page.getByRole("button", { name: "Save service" }).click();
      await toast(`${name} added to service rates.`);
    }
    await page
      .getByRole("cell", { name: "Daily living skills" })
      .first()
      .waitFor();
  });

  await run("staff", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Staff", exact: true })
      .click();
    await page.getByRole("button", { name: "Add team member" }).first().click();
    const drawer = page.locator("aside[role=dialog]");
    await drawer.getByLabel("Full name").fill("Jordan Lee");
    await drawer.getByLabel("Position").fill("Support Worker");
    await drawer.getByLabel("Team").fill("Community Support");
    await drawer.getByLabel("Email").fill("jordan.lee@noble.test");
    await page
      .locator("aside")
      .getByRole("button", { name: "Add team member" })
      .click();
    await toast("Jordan Lee added to the team directory.");
  });

  await run("participant-intake", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Clients", exact: true })
      .click();
    await page.getByRole("button", { name: "Add participant" }).first().click();
    await page.getByPlaceholder("Full legal name").fill("Amelia Carter");
    await page.getByPlaceholder("Name used day to day").fill("Mia");
    await page.getByPlaceholder("9 digits").fill("431 208 775");
    await page.locator('input[type="date"]').first().fill("1996-04-12");
    await page.getByPlaceholder("04xx xxx xxx").fill("0412 830 144");
    await page.getByPlaceholder("name@example.com").fill("amelia@example.org");
    await page
      .getByPlaceholder("Street, suburb, state and postcode")
      .fill("14 Gilbert Street, Adelaide SA 5000");
    const dates = page.locator('input[type="date"]');
    await dates.nth(1).fill("2026-02-01");
    await dates.nth(2).fill("2027-01-31");
    await page
      .getByPlaceholder("Plan manager or Self-managed")
      .fill("Bright Path Plan Management");
    await page
      .getByPlaceholder("invoices@planmanager.com.au")
      .fill("invoices@brightpath.example");
    await page
      .getByPlaceholder("Contact name and relationship")
      .fill("Sarah Carter (mother)");
    await page.getByPlaceholder("Phone number").fill("0411 200 619");
    await page
      .getByPlaceholder("Participant-led goals and outcomes")
      .fill(
        "Build independence with community access\nDevelop meal-planning skills"
      );
    await page
      .getByPlaceholder("Urgent or high-priority information")
      .fill("Anaphylaxis — carry EpiPen");
    await page.getByText("Consent forms", { exact: true }).click();
    await page.getByRole("button", { name: "Create client profile" }).click();
    await page.getByRole("heading", { name: "Amelia Carter" }).waitFor();
    await page.getByText("Anaphylaxis — carry EpiPen").waitFor();
  });

  await run("budget-setup", async () => {
    await page.getByRole("tab", { name: "Budget" }).click();
    await page.getByRole("button", { name: "Set up plan budget" }).click();
    const amounts = page.locator('input[type="number"]');
    await amounts.nth(0).fill("10500");
    await amounts.nth(1).fill("7000");
    await amounts.nth(2).fill("3000");
    await page.getByText("I checked these dates and funding amounts").click();
    await page.getByRole("button", { name: "Save client budget" }).click();
    await page.getByText("Funding by support category").waitFor();
    await page.getByText("$20,500.00").first().waitFor();
  });

  let recordId = "";
  await run("service-record", async () => {
    await page.getByRole("button", { name: "New record" }).click();
    await page.getByRole("heading", { name: "New service record" }).waitFor();
    await page.locator("#record-start").fill("09:00");
    await page.locator("#record-end").fill("12:00");
    await page.locator("#record-location").fill("Marion Shopping Centre");
    await page
      .locator("#field-support")
      .fill("Supported Mia with community access and grocery shopping.");
    await page
      .locator("#field-response")
      .fill("Mia was settled and engaged throughout.");
    await page
      .locator("#field-outcome")
      .fill("Practised making independent choices in the community.");
    await page.locator("#field-observations").fill("No incidents observed.");
    await page
      .locator("#field-followUp")
      .fill("Bring the meal-planning worksheet next visit.");
    await page.locator("#record-km").fill("12.4");
    await page.getByText("I confirm this record is accurate").click();
    await page.getByText("$217.30").first().waitFor();
    await page.getByRole("button", { name: /Submit for review/ }).click();
    await toast("Record submitted to the review queue.");
    await page.waitForURL(/\/app\/records\/SR-\d+/);
    recordId = page.url().split("/").pop();
    await page.getByText("locked from editing").waitFor();
  });

  await run("review-approve", async () => {
    await page.goto(`${BASE}/app/review`);
    await page.getByRole("button", { name: `Review ${recordId}` }).click();
    await page.getByRole("button", { name: /Approve record/ }).click();
    await toast("Record approved.");
  });

  let invoiceId = "";
  await run("invoice", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Invoices", exact: true })
      .click();
    await page.getByRole("button", { name: "Create invoice" }).first().click();
    await page.getByRole("checkbox", { name: `Select ${recordId}` }).check();
    await page.getByRole("button", { name: "Create invoice draft" }).click();
    await page.waitForURL(/\/app\/invoices\/INV-\d{4}-\d{3}/);
    invoiceId = page.url().split("/").pop();
    await page.getByText("Bright Path Plan Management").first().waitFor();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    const file = await download;
    if (!(await file.suggestedFilename()).endsWith(".pdf"))
      throw new Error("PDF download missing");
    await page.getByRole("button", { name: "Mark as sent" }).first().click();
    await page
      .locator(".modal")
      .getByRole("button", { name: "Email and mark sent" })
      .click();
    await toast("Invoice emailed to invoices@brightpath.example.");
    const mail = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
    const sent = mail.messages.find(message =>
      message.Subject.includes(invoiceId)
    );
    if (!sent) throw new Error("Invoice email not found in Mailpit");
    if (!sent.Attachments)
      throw new Error("Invoice email has no PDF attachment");
  });

  await run("roster", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Rostering", exact: true })
      .click();
    await page.getByRole("button", { name: "Create shift" }).click();
    await page
      .locator("aside")
      .getByRole("button", { name: "Save planned shift" })
      .click();
    await toast(/added as a planned shift/);
    await page.locator("article").first().waitFor();
  });

  let voiceUrl = "";
  await run("voice-record", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Voice", exact: true })
      .click();
    await page.getByRole("button", { name: "Open recorder" }).first().click();
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByText("Recording in progress").waitFor();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Stop recording" }).click();
    await page.getByRole("button", { name: "Save recording" }).click();
    await page.waitForURL(/\/app\/voice\/VN-\d+/);
    voiceUrl = page.url();
  });

  await run("voice-transcribe-draft", async () => {
    await page.getByRole("button", { name: "Transcribe" }).click();
    await page.getByText("Demo transcript").waitFor({ timeout: 20_000 });
    await page
      .getByRole("button", { name: "Generate progress note draft" })
      .click();
    await page
      .locator(".modal")
      .getByRole("button", { name: "Generate draft" })
      .click();
    await page
      .getByText("AI-assisted draft · review before submission")
      .waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Create service record" }).click();
    await page.getByRole("heading", { name: "New service record" }).waitFor();
    await page.getByText(/pre-filled from the AI-assisted draft/).waitFor();
    await page.getByRole("button", { name: "Save draft" }).click();
    await toast("Draft saved.");
    await page.waitForURL(/\/app\/records\/SR-\d+/);
  });

  await run("documents", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Clients", exact: true })
      .click();
    await page.getByRole("button", { name: "Amelia Carter" }).first().click();
    await page.getByRole("tab", { name: "Documents" }).click();
    await page.getByRole("button", { name: "Add document" }).click();
    await page
      .locator(".modal select")
      .selectOption({
        label: "Client 001 – AC › 02 Service Agreement & Consent",
      })
      .catch(async () => {
        await page.locator(".modal select").selectOption({ index: 0 });
      });
    await page.locator('.modal input[type="file"]').setInputFiles({
      name: "agreement.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await page
      .locator(".modal")
      .getByPlaceholder("e.g. Signed service agreement")
      .fill("Signed service agreement");
    await page
      .locator(".modal")
      .getByRole("button", { name: "Upload" })
      .click();
    await toast("Signed service agreement uploaded.");
    await page
      .getByRole("button", { name: /02 Service Agreement & Consent/ })
      .click();
    await page.getByText("Signed service agreement").first().waitFor();
    await page.getByRole("button", { name: "Up one folder" }).click();
    await page.getByRole("button", { name: /04 Progress Notes/ }).click();
  });

  await run("organisation-files", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Organisation files", exact: true })
      .click();
    await page.getByRole("button", { name: /04 TEMPLATES/ }).click();
    await page.getByText("Progress Note Template").waitFor();
  });

  await run("dashboard", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Dashboard", exact: true })
      .click();
    await page
      .getByRole("heading", { name: /Good (morning|afternoon|evening), Maya/ })
      .waitFor();
    await page.getByText("Recent activity").waitFor();
    await page
      .getByText(/recorded voice note VN-/)
      .first()
      .waitFor();
    await page.getByText("$217.30").first().waitFor();
  });

  await run("reports", async () => {
    await page
      .locator("aside.sidebar")
      .getByRole("link", { name: "Reports", exact: true })
      .click();
    await page.getByText("Service activity by week").waitFor();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export report" }).click();
    await page.getByRole("button", { name: "Service records (CSV)" }).click();
    await download;
  });

  await run("search-and-notifications", async () => {
    await page.getByPlaceholder("Search anything…").fill("Mia");
    await page.getByText("Participants", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Notifications/ }).click();
    await page.locator("text=Notifications").first().waitFor();
    await page.keyboard.press("Escape");
  });

  await run("settings-privacy", async () => {
    await page.goto(`${BASE}/app/settings/privacy`);
    await page.getByText("Signed-in devices").waitFor();
    await page.getByText("This device").waitFor();
    await page.getByText("Audit log").waitFor();
  });

  await run("mobile-layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/app/clients`);
    await page.getByRole("button", { name: "View profile" }).waitFor();
    await page.locator(".mobile-nav").getByText("Clients").waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await run("logout-login", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await page
      .getByPlaceholder("name@organisation.org.au")
      .fill("maya@noble.test");
    await page.getByPlaceholder("Enter your password").fill("wrong password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("The email or password is incorrect.").waitFor();
    await page
      .getByPlaceholder("Enter your password")
      .fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app$/);
  });

  await run("session-restore", async () => {
    await page.reload();
    await page
      .getByRole("heading", { name: /Good (morning|afternoon|evening), Maya/ })
      .waitFor();
    await page.goto(voiceUrl);
    await page.getByRole("button", { name: "Play audio" }).click();
    await page.locator("audio").waitFor();
  });
} catch {
  /* reported below */
} finally {
  console.log(results.join("\n"));
  console.log(
    problems.length
      ? `\nPROBLEMS (${problems.length}):\n${[...new Set(problems)].join("\n")}`
      : "\nNo console errors or 5xx responses."
  );
  process.exitCode =
    results.length &&
    results.every(line => line.startsWith("PASS")) &&
    !problems.length
      ? 0
      : 1;
  await browser.close();
}
