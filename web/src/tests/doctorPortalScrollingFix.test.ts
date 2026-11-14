import assert from "node:assert/strict";

// Mock minimal DOM environment for testing modal scroll locking and cleanup behavior
class MockDOM {
  attributes = new Map<string, string>();
  style: { overflow: string; paddingRight: string } = { overflow: "", paddingRight: "" };

  getAttribute(key: string): string | null {
    return this.attributes.has(key) ? this.attributes.get(key)! : null;
  }

  setAttribute(key: string, val: string): void {
    this.attributes.set(key, val);
  }

  removeAttribute(key: string): void {
    this.attributes.delete(key);
  }
}

// Emulate ModalPortal scroll-locking logic
function openModalPortal(mockBody: MockDOM) {
  const prevCount = Number(mockBody.getAttribute("data-modal-count") || "0");
  mockBody.setAttribute("data-modal-count", String(prevCount + 1));

  if (prevCount === 0) {
    const rawOverflow = mockBody.style.overflow;
    const originalOverflow = rawOverflow === "hidden" ? "" : rawOverflow;
    const originalPaddingRight = mockBody.style.paddingRight;
    mockBody.setAttribute("data-orig-overflow", originalOverflow);
    mockBody.setAttribute("data-orig-padding-right", originalPaddingRight);

    mockBody.style.overflow = "hidden";
  }

  return () => {
    const remainingCount = Math.max(
      0,
      Number(mockBody.getAttribute("data-modal-count") || "1") - 1
    );
    if (remainingCount === 0) {
      const storedOverflow = mockBody.getAttribute("data-orig-overflow") ?? "";
      const storedPadding = mockBody.getAttribute("data-orig-padding-right") ?? "";

      mockBody.removeAttribute("data-modal-count");
      mockBody.removeAttribute("data-orig-overflow");
      mockBody.removeAttribute("data-orig-padding-right");

      mockBody.style.overflow = storedOverflow === "hidden" ? "" : storedOverflow;
      mockBody.style.paddingRight = storedPadding;
    } else {
      mockBody.setAttribute("data-modal-count", String(remainingCount));
    }
  };
}

// Emulate DoctorLayout route/branch navigation cleanup effect
function runDoctorLayoutNavigationGuard(mockBody: MockDOM) {
  const modalCount = Number(mockBody.getAttribute("data-modal-count") || "0");
  if (modalCount === 0 && mockBody.style.overflow === "hidden") {
    mockBody.style.overflow = "";
    mockBody.style.paddingRight = "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

console.log("Starting Doctor Portal Scrolling & Modal Scroll-Lock Tests...\n");

// Test 1: Opening and closing a single modal in Doctor Portal restores overflow to ""
{
  const mockBody = new MockDOM();
  assert.equal(mockBody.style.overflow, "", "Initial body overflow must be empty string");

  const close = openModalPortal(mockBody);
  assert.equal(mockBody.style.overflow, "hidden", "Body overflow must be hidden while modal is open");
  assert.equal(mockBody.getAttribute("data-modal-count"), "1", "Modal count must be 1");

  close();
  assert.equal(mockBody.style.overflow, "", "Body overflow must be restored to empty string after closing");
  assert.equal(mockBody.getAttribute("data-modal-count"), null, "Modal count attribute must be removed");
  console.log("✓ Test 1 Passed: ModalPortal cleanly opens and restores body scrolling.");
}

// Test 2: Nested modals (e.g. Consultation modal + Zoomable skin photo) preserve scroll lock until all close
{
  const mockBody = new MockDOM();
  const closeParentModal = openModalPortal(mockBody);
  assert.equal(mockBody.style.overflow, "hidden");
  assert.equal(mockBody.getAttribute("data-modal-count"), "1");

  const closeChildPhotoModal = openModalPortal(mockBody);
  assert.equal(mockBody.style.overflow, "hidden");
  assert.equal(mockBody.getAttribute("data-modal-count"), "2");

  closeChildPhotoModal();
  assert.equal(mockBody.style.overflow, "hidden", "Parent modal is still open, body must remain locked");
  assert.equal(mockBody.getAttribute("data-modal-count"), "1");

  closeParentModal();
  assert.equal(mockBody.style.overflow, "", "All modals closed: body scrolling must be restored");
  assert.equal(mockBody.getAttribute("data-modal-count"), null);
  console.log("✓ Test 2 Passed: Nested modal scroll locking preserves lock until all close.");
}

// Test 3: If a dirty scroll lock was left by an external component, ModalPortal does NOT memorize 'hidden'
{
  const mockBody = new MockDOM();
  mockBody.style.overflow = "hidden"; // Stale lock left behind

  const close = openModalPortal(mockBody);
  assert.equal(mockBody.getAttribute("data-orig-overflow"), "", "ModalPortal must guard against memorizing stale 'hidden'");

  close();
  assert.equal(mockBody.style.overflow, "", "ModalPortal close must clear stale 'hidden' overflow");
  console.log("✓ Test 3 Passed: ModalPortal safely avoids memorizing stale 'hidden' states.");
}

// Test 4: DoctorLayout navigation guard clears any uncoordinated scroll lock on route change
{
  const mockBody = new MockDOM();
  mockBody.style.overflow = "hidden"; // Left locked due to route transition
  assert.equal(mockBody.getAttribute("data-modal-count"), null);

  // User navigates from /doctor to /doctor/settings
  runDoctorLayoutNavigationGuard(mockBody);
  assert.equal(mockBody.style.overflow, "", "DoctorLayout navigation guard must restore scroll on route change");
  console.log("✓ Test 4 Passed: DoctorLayout navigation guard restores scroll on route change.");
}

// Test 5: DoctorLayout navigation guard preserves lock if a modal is legitimately open
{
  const mockBody = new MockDOM();
  openModalPortal(mockBody); // Legitimate modal open
  assert.equal(mockBody.style.overflow, "hidden");
  assert.equal(mockBody.getAttribute("data-modal-count"), "1");

  runDoctorLayoutNavigationGuard(mockBody);
  assert.equal(mockBody.style.overflow, "hidden", "Guard must not unlock while modal is actively open");
  console.log("✓ Test 5 Passed: Active modals retain their background scroll lock.");
}

console.log("\nAll 5 Doctor Portal Scrolling & Modal Scroll-Lock Tests Passed Successfully!");

