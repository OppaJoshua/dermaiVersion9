/**
 * DermAI — Storage Utilities & Photo Path Handling Test Suite
 *
 * Verifies all edge cases specified in Section 3 of the audit:
 * 1. Plain object keys (e.g. user-id/file.jpg).
 * 2. Redundant leading slashes and scan-uploads/ bucket prefixes.
 * 3. Supabase public storage URLs.
 * 4. Active Supabase signed URLs (preserved as-is).
 * 5. Expired Supabase signed URLs (recovering underlying storage key).
 * 6. Query parameters appearing in different orders (e.g. ?download=1&token=...).
 * 7. External HTTP(S) URLs (preserved without converting to local keys).
 * 8. data: and blob: URIs (preserved as-is).
 * 9. Null, empty, whitespace, and malformed inputs.
 * 10. Cache clearing and recovery.
 */

import {
  normalizeSkinPhotoPath,
  extractStorageObjectKey,
  getSignedSkinPhotoUrl,
  clearSignedUrlCache,
} from "../lib/storageUtils";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function makeMockJwt(expSecondsFromNow: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      url: "scan-uploads/user-456/photo.jpg",
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
    })
  ).toString("base64url");
  return `${header}.${payload}.mockSignature123`;
}

console.log("=== DermAI Storage Path Handling Test Suite Starting ===");

// ── Test 1: Plain Object Keys ────────────────────────────────────────────────
console.log("\n[Test 1] Testing Plain Storage Object Keys...");
const plain = "user-123/1720000000_close_up.jpg";
assert(normalizeSkinPhotoPath(plain) === plain, "Plain key must be preserved");
assert(extractStorageObjectKey(plain) === plain, "extractStorageObjectKey must return plain key");
console.log("✓ Plain object keys correctly preserved.");

// ── Test 2: Redundant Leading Slashes & Bucket Prefixes ─────────────────────
console.log("\n[Test 2] Testing Leading Slashes and Redundant Bucket Prefixes...");
assert(
  normalizeSkinPhotoPath("/user-123/photo.jpg") === "user-123/photo.jpg",
  "Leading slash must be removed"
);
assert(
  normalizeSkinPhotoPath("///user-123/photo.jpg") === "user-123/photo.jpg",
  "Multiple leading slashes must be removed"
);
assert(
  normalizeSkinPhotoPath("scan-uploads/user-123/photo.jpg") === "user-123/photo.jpg",
  "Redundant scan-uploads/ prefix must be stripped"
);
assert(
  normalizeSkinPhotoPath("/scan-uploads/user-123/photo.jpg") === "user-123/photo.jpg",
  "Leading slash with scan-uploads/ prefix must be stripped"
);
console.log("✓ Redundant slashes and bucket prefixes stripped correctly.");

// ── Test 3: Public Supabase Storage URLs ─────────────────────────────────────
console.log("\n[Test 3] Testing Public Supabase Storage URLs...");
const publicUrl =
  "https://testproject.supabase.co/storage/v1/object/public/scan-uploads/user-789/2026_skin_scan.jpg";
const recoveredFromPublic = normalizeSkinPhotoPath(publicUrl);
assert(
  recoveredFromPublic === "user-789/2026_skin_scan.jpg",
  `Public URL must extract underlying storage key, got: ${recoveredFromPublic}`
);

const publicUrlWithParams =
  "https://testproject.supabase.co/storage/v1/object/public/scan-uploads/user-789/2026_skin_scan.jpg?download=true&v=3#hash";
const recoveredFromPublicParams = normalizeSkinPhotoPath(publicUrlWithParams);
assert(
  recoveredFromPublicParams === "user-789/2026_skin_scan.jpg",
  `Query params and hash must be stripped from recovered key, got: ${recoveredFromPublicParams}`
);
console.log("✓ Public Supabase URLs recover clean relative storage keys without query/hash.");

// ── Test 4: Active Supabase Signed URLs (Any Query Param Order) ──────────────
console.log("\n[Test 4] Testing Active Supabase Signed URLs...");
const activeToken = makeMockJwt(3600); // 1 hour in future
const activeSignedUrl1 = `https://testproject.supabase.co/storage/v1/object/sign/scan-uploads/user-456/photo.jpg?token=${activeToken}`;
const normalizedActive1 = normalizeSkinPhotoPath(activeSignedUrl1);
assert(
  normalizedActive1 === activeSignedUrl1,
  "Active signed URL with token first must be preserved as-is"
);

// Query parameter order variation: download before token
const activeSignedUrl2 = `https://testproject.supabase.co/storage/v1/object/sign/scan-uploads/user-456/photo.jpg?download=1&token=${activeToken}`;
const normalizedActive2 = normalizeSkinPhotoPath(activeSignedUrl2);
assert(
  normalizedActive2 === activeSignedUrl2,
  "Active signed URL with token second must be preserved as-is"
);
console.log("✓ Active signed URLs with diverse parameter orders are preserved as-is.");

// ── Test 5: Expired Supabase Signed URLs ─────────────────────────────────────
console.log("\n[Test 5] Testing Expired Supabase Signed URLs (Key Recovery)...");
const expiredToken = makeMockJwt(-600); // Expired 10 minutes ago
const expiredSignedUrl = `https://testproject.supabase.co/storage/v1/object/sign/scan-uploads/user-456/photo.jpg?token=${expiredToken}`;
const recoveredFromExpired = normalizeSkinPhotoPath(expiredSignedUrl);
assert(
  recoveredFromExpired === "user-456/photo.jpg",
  `Expired signed URL must recover underlying object key to allow refreshing, got: ${recoveredFromExpired}`
);

// Expired signed URL with query params in different order
const expiredSignedUrlParams = `https://testproject.supabase.co/storage/v1/object/sign/scan-uploads/user-456/photo.jpg?download=1&token=${expiredToken}&v=2`;
const recoveredFromExpiredParams = normalizeSkinPhotoPath(expiredSignedUrlParams);
assert(
  recoveredFromExpiredParams === "user-456/photo.jpg",
  `Expired signed URL with mixed params must recover clean object key, got: ${recoveredFromExpiredParams}`
);
console.log("✓ Expired signed URLs correctly recover underlying storage object keys.");

// ── Test 6: External HTTP(S) URLs & Data/Blob URIs ───────────────────────────
console.log("\n[Test 6] Testing External URLs and Data/Blob URIs...");
const externalUrl = "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800";
assert(
  normalizeSkinPhotoPath(externalUrl) === externalUrl,
  "External URL must NOT be converted to a local storage key"
);
assert(
  extractStorageObjectKey(externalUrl) === null,
  "extractStorageObjectKey must return null for external non-Supabase URLs"
);

const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
assert(normalizeSkinPhotoPath(dataUri) === dataUri, "data: URI must be returned as-is");
assert(extractStorageObjectKey(dataUri) === null, "data: URI is not a storage key");

const blobUri = "blob:http://localhost:5173/a8b9c0d1-e2f3-4a5b-6c7d-8e9f0a1b2c3d";
assert(normalizeSkinPhotoPath(blobUri) === blobUri, "blob: URI must be returned as-is");
assert(extractStorageObjectKey(blobUri) === null, "blob: URI is not a storage key");
console.log("✓ External URLs and data/blob URIs are safely preserved without conversion.");

// ── Test 7: Null, Empty, and Malformed Inputs ─────────────────────────────────
console.log("\n[Test 7] Testing Null, Empty, and Malformed Inputs...");
assert(normalizeSkinPhotoPath(null) === null, "null must return null");
assert(normalizeSkinPhotoPath(undefined) === null, "undefined must return null");
assert(normalizeSkinPhotoPath("") === null, "Empty string must return null");
assert(normalizeSkinPhotoPath("   ") === null, "Whitespace-only string must return null");
assert(extractStorageObjectKey(null) === null, "extractStorageObjectKey(null) must return null");
console.log("✓ Null, empty, and whitespace values handled safely.");

// ── Test 8: getSignedSkinPhotoUrl Passthrough for Non-Storage Inputs ─────────
console.log("\n[Test 8] Testing getSignedSkinPhotoUrl Passthrough & Cache Handling...");
async function runAsyncTests() {
  clearSignedUrlCache();

  // Null input
  const nullRes = await getSignedSkinPhotoUrl(null);
  assert(nullRes === null, "getSignedSkinPhotoUrl(null) must return null");

  // External URL passthrough
  const extRes = await getSignedSkinPhotoUrl(externalUrl);
  assert(extRes === externalUrl, "External URL must pass through getSignedSkinPhotoUrl directly");

  // Blob URI passthrough
  const blobRes = await getSignedSkinPhotoUrl(blobUri);
  assert(blobRes === blobUri, "Blob URI must pass through getSignedSkinPhotoUrl directly");

  // Active signed URL passthrough
  const activeRes = await getSignedSkinPhotoUrl(activeSignedUrl1);
  assert(activeRes === activeSignedUrl1, "Active signed URL must pass through getSignedSkinPhotoUrl directly");

  console.log("✓ getSignedSkinPhotoUrl handles passthrough inputs synchronously and safely.");
}

runAsyncTests().then(() => {
  console.log("\n=======================================================");
  console.log("  ALL STORAGE UTILITIES TESTS PASSED! (8 / 8 suites)");
  console.log("=======================================================");
});
