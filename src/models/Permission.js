import mongoose from "mongoose";

const permissionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    label: {
      type: String,
      required: true,
      trim: true
    },
    group: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: "",
      trim: true
    }
  },
  { timestamps: true }
);

const Permission = mongoose.model("Permission", permissionSchema);

export default Permission;