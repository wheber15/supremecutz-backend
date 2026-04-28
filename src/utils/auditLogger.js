import AuditLog from "../models/AuditLog.js";

export async function logAudit({
  actor,
  action,
  entityType,
  entityId = "",
  entityLabel = "",
  locationId = null,
  changes = {},
  meta = {}
}) {
  try {
    await AuditLog.create({
      actorUserId: actor?._id || null,
      actorName: actor?.fullName || "",
      actorRole: actor?.role || "",
      action,
      entityType,
      entityId,
      entityLabel,
      locationId,
      changes,
      meta
    });
  } catch (error) {
    console.error("Audit log failed:", error.message);
  }
}