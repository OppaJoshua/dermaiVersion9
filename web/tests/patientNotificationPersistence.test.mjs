import test from "node:test";
import assert from "node:assert/strict";

/**
 * Mirror of isNotificationRead from web/src/lib/notificationService.ts
 */
function isNotificationRead(id, dbIsRead, readSet, meta) {
  if (dbIsRead) return true;
  if (readSet.has(id)) return true;

  if (meta?.appointmentId) {
    const aid = String(meta.appointmentId);
    if (
      readSet.has(aid) ||
      readSet.has(`appt:${aid}`) ||
      readSet.has(`appt-accepted-${aid}`) ||
      readSet.has(`appt-completed-${aid}`) ||
      readSet.has(`appt-rejected-${aid}`) ||
      readSet.has(`appt-cancelled-${aid}`) ||
      readSet.has(`appt-scheduled-${aid}`)
    ) {
      return true;
    }
  }

  if (meta?.ticketId) {
    const tid = String(meta.ticketId);
    if (readSet.has(tid) || readSet.has(`ticket:${tid}`) || readSet.has(`ticket-update-${tid}`)) {
      return true;
    }
  }

  if (meta?.broadcastId) {
    const bid = String(meta.broadcastId);
    if (readSet.has(bid) || readSet.has(`broadcast:${bid}`)) {
      return true;
    }
  }

  if (meta?.analysisId) {
    const sid = String(meta.analysisId);
    if (readSet.has(sid) || readSet.has(`scan:${sid}`) || readSet.has(`scan-${sid}`)) {
      return true;
    }
  }

  if (meta?.title && meta?.message) {
    const key = `content:${meta.title.trim().toLowerCase()}:::${meta.message.trim().toLowerCase()}`;
    if (readSet.has(key)) return true;
  }

  return false;
}

/**
 * Mirror of deduplicateNotificationItems from web/src/lib/notificationService.ts
 */
function deduplicateNotificationItems(items) {
  const seenIds = new Set();
  const seenBroadcastIds = new Set();
  const seenContentKeys = new Set();
  const seenApptActions = new Set();
  const itemByKey = new Map();

  // Sort so persistent database records with UUID IDs take precedence over synthetic fallback IDs
  const sorted = [...items].sort((a, b) => {
    const isAUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id);
    const isBUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id);
    if (isAUuid && !isBUuid) return -1;
    if (!isAUuid && isBUuid) return 1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const result = [];
  for (const item of sorted) {
    if (seenIds.has(item.id)) {
      const existing = itemByKey.get(item.id);
      if (existing && item.isRead && !existing.isRead) {
        existing.isRead = true;
      }
      continue;
    }

    const broadcastId = item.metadata?.broadcast_id;
    if (broadcastId) {
      if (seenBroadcastIds.has(broadcastId)) {
        const existing = itemByKey.get(`broadcast:${broadcastId}`);
        if (existing && item.isRead && !existing.isRead) {
          existing.isRead = true;
        }
        continue;
      }
      seenBroadcastIds.add(broadcastId);
      itemByKey.set(`broadcast:${broadcastId}`, item);
    }

    const contentKey = `${item.title.trim().toLowerCase()}:::${item.message.trim().toLowerCase()}`;
    if (seenContentKeys.has(contentKey)) {
      const existing = itemByKey.get(`content:${contentKey}`);
      if (existing && item.isRead && !existing.isRead) {
        existing.isRead = true;
      }
      continue;
    }

    const apptId = item.metadata?.appointment_id;
    const subtype = item.metadata?.subtype || item.type;
    if (apptId && subtype) {
      const apptActionKey = `${apptId}:::${subtype}`;
      if (seenApptActions.has(apptActionKey)) {
        const existing = itemByKey.get(`apptAction:${apptActionKey}`);
        if (existing && item.isRead && !existing.isRead) {
          existing.isRead = true;
        }
        continue;
      }
      seenApptActions.add(apptActionKey);
      itemByKey.set(`apptAction:${apptActionKey}`, item);
    }

    seenIds.add(item.id);
    seenContentKeys.add(contentKey);
    itemByKey.set(item.id, item);
    itemByKey.set(`content:${contentKey}`, item);
    result.push(item);
  }
  return result;
}

// User-scoped read ID storage simulation mirroring getReadIds / saveReadId / saveAllReadIds
class MockUserScopedStore {
  constructor() {
    this.store = new Map();
  }
  getReadIds(role, userId, fallbackId) {
    const combined = new Set();
    const keys = userId || fallbackId
      ? ([userId, fallbackId].filter(Boolean))
      : ["default"];
    for (const k of keys) {
      const raw = this.store.get(`dermai_${role}_read_ids_${k}`);
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) arr.forEach((id) => combined.add(id));
        } catch {}
      }
    }
    return combined;
  }
  saveReadId(role, id, userId, fallbackId, extraIds) {
    const keys = userId || fallbackId
      ? ([userId, fallbackId].filter(Boolean))
      : ["default"];
    for (const k of keys) {
      const key = `dermai_${role}_read_ids_${k}`;
      const set = this.getReadIds(role, k);
      set.add(id);
      if (extraIds && Array.isArray(extraIds)) {
        extraIds.forEach((eid) => set.add(eid));
      }
      this.store.set(key, JSON.stringify(Array.from(set)));
    }
  }
  saveAllReadIds(role, ids, userId, fallbackId) {
    const keys = userId || fallbackId
      ? ([userId, fallbackId].filter(Boolean))
      : ["default"];
    for (const k of keys) {
      const key = `dermai_${role}_read_ids_${k}`;
      const set = this.getReadIds(role, k);
      ids.forEach((id) => set.add(id));
      this.store.set(key, JSON.stringify(Array.from(set)));
    }
  }
}

test("Notification Persistence Test Suite", async (t) => {
  let store;
  t.beforeEach(() => {
    store = new MockUserScopedStore();
  });

  await t.test("Scenario A: Marking a scan notification read persists via analysis ID alias across re-fetch", () => {
    const patientId = "patient-user-001";
    // Mark scan read with analysis alias
    store.saveReadId("patient", "scan-analysis-123", patientId, undefined, [
      "analysis-123",
      "scan:analysis-123",
    ]);

    const readSet = store.getReadIds("patient", patientId);
    const isRead = isNotificationRead("scan-analysis-123", false, readSet, {
      analysisId: "analysis-123",
      title: "AI Skin Scan Complete",
      message: "Analysis ready",
    });
    assert.strictEqual(isRead, true, "Scan notification should be recognized as read via alias");
  });

  await t.test("Scenario A: Unrelated read items do not falsely mark unread notifications", () => {
    const patientId = "patient-user-001";
    store.saveReadId("patient", "scan-analysis-999", patientId);
    const readSet = store.getReadIds("patient", patientId);

    const isRead = isNotificationRead("scan-analysis-123", false, readSet, {
      analysisId: "analysis-123",
      title: "AI Skin Scan Complete",
      message: "Analysis ready",
    });
    assert.strictEqual(isRead, false, "Unrelated read item should not mark this notification read");
  });

  await t.test("Scenario B: Marking all notifications as read preserves 0 unread count across deduplication", () => {
    const patientId = "patient-user-001";
    const notificationIds = ["notif-uuid-1", "notif-uuid-2", "appt-accepted-appt-123"];
    store.saveAllReadIds("patient", notificationIds, patientId);

    const readSet = store.getReadIds("patient", patientId);
    const items = [
      {
        id: "notif-uuid-1",
        title: "Doctor Confirmed Schedule",
        message: "Your schedule has been confirmed",
        timestamp: new Date().toISOString(),
        isRead: isNotificationRead("notif-uuid-1", false, readSet),
      },
      {
        id: "notif-uuid-2",
        title: "AI Skin Scan Complete",
        message: "Analysis completed",
        timestamp: new Date().toISOString(),
        isRead: isNotificationRead("notif-uuid-2", false, readSet),
      },
      {
        id: "appt-accepted-appt-123",
        title: "Doctor Confirmed Schedule",
        message: "Your schedule has been confirmed",
        timestamp: new Date().toISOString(),
        isRead: isNotificationRead("appt-accepted-appt-123", false, readSet),
      },
    ];

    const deduplicated = deduplicateNotificationItems(items);
    const unreadCount = deduplicated.filter((item) => !item.isRead).length;
    assert.strictEqual(unreadCount, 0, "All items should remain read and unread count should be 0");
  });

  await t.test("Scenario C: Genuinely new notification arrives unread while existing notifications remain read", () => {
    const patientId = "patient-user-001";
    store.saveReadId("patient", "notif-1", patientId);
    store.saveReadId("patient", "notif-2", patientId);

    const readSet = store.getReadIds("patient", patientId);
    const items = [
      {
        id: "notif-1",
        title: "Welcome",
        message: "Welcome to DermAI",
        timestamp: "2026-11-01T10:00:00Z",
        isRead: isNotificationRead("notif-1", false, readSet),
      },
      {
        id: "notif-2",
        title: "AI Skin Scan Complete",
        message: "Your scan results are ready",
        timestamp: "2026-11-02T10:00:00Z",
        isRead: isNotificationRead("notif-2", false, readSet),
      },
      {
        id: "notif-3-new",
        title: "Doctor Confirmed Schedule",
        message: "Appointment confirmed for tomorrow",
        timestamp: "2026-11-03T10:00:00Z",
        isRead: isNotificationRead("notif-3-new", false, readSet),
      },
    ];

    const deduplicated = deduplicateNotificationItems(items);
    assert.strictEqual(deduplicated.find((n) => n.id === "notif-1")?.isRead, true);
    assert.strictEqual(deduplicated.find((n) => n.id === "notif-2")?.isRead, true);
    assert.strictEqual(deduplicated.find((n) => n.id === "notif-3-new")?.isRead, false);
    const unreadCount = deduplicated.filter((n) => !n.isRead).length;
    assert.strictEqual(unreadCount, 1, "Only the genuinely new notification should be unread");
  });

  await t.test("Scenario D: Strict multi-user isolation — Patient A read history does not leak to Patient B", () => {
    const patientAId = "patient-alice";
    const patientBId = "patient-bob";

    store.saveReadId("patient", "broadcast-maintenance-123", patientAId);

    const readSetA = store.getReadIds("patient", patientAId);
    const readSetB = store.getReadIds("patient", patientBId);

    assert.strictEqual(isNotificationRead("broadcast-maintenance-123", false, readSetA), true);
    assert.strictEqual(isNotificationRead("broadcast-maintenance-123", false, readSetB), false);
  });

  await t.test("Scenario E: Synthetic appointment ID alias matching", () => {
    const rawApptId = "550e8400-e29b-41d4-a716-446655440000";
    const patientId = "patient-alice";

    // Patient clicks synthetic notification
    store.saveReadId("patient", `appt-accepted-${rawApptId}`, patientId, undefined, [
      rawApptId,
      `appt:${rawApptId}`,
    ]);

    const readSet = store.getReadIds("patient", patientId);

    // Check DB row with metadata.appointment_id
    const dbNotifRead = isNotificationRead("db-notif-uuid-999", false, readSet, {
      appointmentId: rawApptId,
    });
    assert.strictEqual(dbNotifRead, true, "DB notification should resolve as read via appointmentId alias");

    // Check synthetic item
    const syntheticRead = isNotificationRead(`appt-accepted-${rawApptId}`, false, readSet);
    assert.strictEqual(syntheticRead, true, "Synthetic item should resolve as read directly");
  });

  await t.test("Scenario F: Deduplication preserves isRead: true when unread duplicate appears first", () => {
    const duplicateUnreadFirst = [
      {
        id: "dup-1",
        title: "Test Title",
        message: "Test Message",
        timestamp: "2026-11-01T10:00:00Z",
        isRead: false,
      },
      {
        id: "dup-2",
        title: "Test Title",
        message: "Test Message",
        timestamp: "2026-11-01T10:00:00Z",
        isRead: true,
      },
    ];

    const deduplicated = deduplicateNotificationItems(duplicateUnreadFirst);
    assert.strictEqual(deduplicated.length, 1, "Items should be deduplicated to 1 item");
    assert.strictEqual(deduplicated[0].isRead, true, "Deduplication must retain isRead: true even if unread was first");
  });

  await t.test("Scenario G: Content key alias correctly identifies identical notifications", () => {
    const readSet = new Set(["content:ai skin scan complete:::your scan results are ready."]);
    const isRead = isNotificationRead("notif-any-id", false, readSet, {
      title: "  AI Skin Scan Complete ",
      message: "Your scan results are ready. ",
    });
    assert.strictEqual(isRead, true, "Notification matching content key should be considered read");
  });
});
