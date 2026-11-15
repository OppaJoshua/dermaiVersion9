import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the actual supabase function file
const expiryFunctionPath = path.resolve(
  __dirname,
  "../../supabase/functions/subscription-expiry/index.ts"
);
const expiryCode = fs.readFileSync(expiryFunctionPath, "utf-8");

// Extract the renderExpiryEmailHtml and renderExpiryEmailText functions for isolated execution
function extractFunctionBody(code, fnName) {
  const marker = `function ${fnName}`;
  const startIdx = code.indexOf(marker);
  if (startIdx === -1) {
    throw new Error(`Could not find ${fnName} in ${expiryFunctionPath}`);
  }
  const colonIdx = code.indexOf("): string {", startIdx);
  const bodyStartIdx = colonIdx !== -1 ? colonIdx + "): string {".length - 1 : code.indexOf("{", startIdx);

  let braceCount = 0;
  let endIdx = -1;
  for (let i = bodyStartIdx; i < code.length; i++) {
    if (code[i] === "{") {
      braceCount++;
    } else if (code[i] === "}") {
      braceCount--;
      if (braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  const body = code.slice(bodyStartIdx, endIdx);
  const param = fnName === "escapeHtml" ? "value" : "opts";
  return `function ${fnName}(${param}) ${body}`;
}

const escapeHtmlCode = extractFunctionBody(expiryCode, "escapeHtml");
const renderExpiryEmailHtmlCode = extractFunctionBody(expiryCode, "renderExpiryEmailHtml");
const renderExpiryEmailTextCode = extractFunctionBody(expiryCode, "renderExpiryEmailText");

// Build callable functions
const evalScope = new Function(`
  ${escapeHtmlCode}
  ${renderExpiryEmailHtmlCode}
  ${renderExpiryEmailTextCode}
  return { renderExpiryEmailHtml, renderExpiryEmailText };
`);
const { renderExpiryEmailHtml, renderExpiryEmailText } = evalScope();

test("subscription-expiry HTML template: does not contain any upgrade elements", () => {
  const periodLabel = "November 14, 2026, 8:01 PM";
  const html = renderExpiryEmailHtml({ periodLabel });

  // 1. Highlighted box message must NOT be present
  assert.equal(
    html.includes("To restore unlimited scans"),
    false,
    "HTML must not contain 'To restore unlimited scans' message"
  );
  assert.equal(
    html.includes("full condition tracking"),
    false,
    "HTML must not contain 'full condition tracking'"
  );

  // 2. 'Upgrade to Pro' button must NOT be present
  assert.equal(
    html.includes("Upgrade to Pro"),
    false,
    "HTML must not contain 'Upgrade to Pro' button"
  );

  // 3. Fallback text must NOT be present
  assert.equal(
    html.includes("If the button above does not work"),
    false,
    "HTML must not contain 'If the button above does not work' fallback text"
  );
  assert.equal(
    html.includes("copy this link into your browser"),
    false,
    "HTML must not contain 'copy this link into your browser'"
  );

  // 4. Localhost / dashboard upgrade URL must NOT be present
  assert.equal(
    html.includes("http://localhost:5173/dashboard/upgrade"),
    false,
    "HTML must not contain 'http://localhost:5173/dashboard/upgrade'"
  );
  assert.equal(
    html.includes("dashboard/upgrade"),
    false,
    "HTML must not contain 'dashboard/upgrade'"
  );

  // 5. Expected sequence: Body proceeds directly to Sign-off
  assert.equal(html.includes("Your Pro subscription has expired"), true);
  assert.equal(html.includes(periodLabel), true);
  assert.equal(html.includes("Free Plan"), true);
  assert.equal(
    html.includes("You can continue using DermAI with standard free scans and basic features."),
    true
  );
  assert.equal(html.includes("Thank you for using DermAI."), true);
  assert.equal(html.includes("Best regards,"), true);
  assert.equal(html.includes("The DermAI Team"), true);

  // Verify direct transition: After the account data paragraph, the next content is Sign-off
  const dataSafetyIdx = html.indexOf(
    "Your previous scan history and account data remain completely safe and accessible."
  );
  const signOffIdx = html.indexOf("Thank you for using DermAI.");
  assert.ok(dataSafetyIdx !== -1, "Body paragraph present");
  assert.ok(signOffIdx !== -1, "Sign-off present");
  assert.ok(signOffIdx > dataSafetyIdx, "Sign-off appears after body paragraph");

  // In between, there should only be table cells/closing tags, no intermediate text
  const intermediateHtml = html.slice(dataSafetyIdx, signOffIdx);
  assert.equal(intermediateHtml.includes("upgrade"), false, "No upgrade content between body and sign-off");
  assert.equal(intermediateHtml.includes("Upgrade"), false, "No Upgrade content between body and sign-off");
  assert.equal(intermediateHtml.includes("href"), false, "No links between body and sign-off");
});

test("subscription-expiry Plain Text template: does not contain any upgrade elements", () => {
  const periodLabel = "November 14, 2026, 8:01 PM";
  const text = renderExpiryEmailText({ periodLabel });

  // Negative assertions
  assert.equal(text.includes("To restore unlimited scans"), false);
  assert.equal(text.includes("Upgrade to Pro"), false);
  assert.equal(text.includes("upgrade"), false);
  assert.equal(text.includes("dashboard/upgrade"), false);
  assert.equal(text.includes("http://localhost:5173"), false);

  // Positive assertions
  assert.equal(text.includes("Hello,"), true);
  assert.equal(text.includes(`Your DermAI Pro subscription expired on ${periodLabel}`), true);
  assert.equal(text.includes("Free Plan"), true);
  assert.equal(text.includes("Thank you for using DermAI."), true);
  assert.equal(text.includes("Best regards,"), true);
  assert.equal(text.includes("The DermAI Team"), true);

  // Verify direct transition in plain text
  const expectedText = [
    "Hello,",
    "",
    `Your DermAI Pro subscription expired on ${periodLabel}, and your account is now using the Free Plan.`,
    "",
    "You can continue using DermAI with standard free scans and basic features. Your scan records remain saved in your account.",
    "",
    "Thank you for using DermAI.",
    "",
    "Best regards,",
    "The DermAI Team",
  ].join("\n");

  assert.equal(text, expectedText, "Plain text template matches the exact expected layout");
});

test("subscription-expiry source code: no leftover localhost upgrade URLs", () => {
  assert.equal(
    expiryCode.includes("dashboard/upgrade"),
    false,
    "Source code must not contain dashboard/upgrade"
  );
  assert.equal(
    expiryCode.includes("http://localhost:5173/dashboard/upgrade"),
    false,
    "Source code must not contain http://localhost:5173/dashboard/upgrade"
  );
});
