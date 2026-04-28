import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    actorName: {
      type: String,
      default: "",
      trim: true
    },
    actorRole: {
      type: String,
      default: "",
      trim: true
    },

    action: {
      type: String,
      required: true,
      trim: true
    },

    entityType: {
      type: String,
      required: true,
      trim: true
    },

    entityId: {
      type: String,
      default: "",
      trim: true
    },

    entityLabel: {
      type: String,
      default: "",
      trim: true
    },

    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null
    },

    changes: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;