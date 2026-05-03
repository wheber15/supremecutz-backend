import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      default: "",
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    canLogin: {
      type: Boolean,
      default: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    staffPinHash: {
      type: String,
      default: "",
      select: false
    },
    phone: {
      type: String,
      default: "",
      trim: true
    },
    role: {
      type: String,
      required: true,
      default: "staff",
      enum: ["founder", "owner", "manager", "supervisor", "staff", "barber"]
    },
    permissions: {
      type: [String],
      default: []
    },
    locationIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Location"
      }
    ],
    primaryLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isBookableBarber: {
      type: Boolean,
      default: false
    },
    barberDisplayName: {
      type: String,
      default: "",
      trim: true
    },
    barberSpecialty: {
      type: String,
      default: "",
      trim: true
    },
    notes: {
      type: String,
      default: "",
      trim: true
    }
  },
  {
    timestamps: true
  }
);

userSchema.pre("validate", function () {
  if ((!this.name || !this.name.trim()) && this.fullName && this.fullName.trim()) {
    this.name = this.fullName.trim();
  }

  if ((!this.fullName || !this.fullName.trim()) && this.name && this.name.trim()) {
    this.fullName = this.name.trim();
  }

  if (this.role === "barber") {
    this.isBookableBarber = true;
  }

  if (
    this.role === "barber" &&
    (!this.barberDisplayName || !this.barberDisplayName.trim())
  ) {
    this.barberDisplayName = this.fullName || this.name || "";
  }
});

const User = mongoose.model("User", userSchema);

export default User;