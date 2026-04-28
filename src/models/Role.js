import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    label: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: "",
      trim: true
    },
    permissions: {
      type: [String],
      default: []
    },
    isSystemRole: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

const Role = mongoose.model("Role", roleSchema);

export default Role;