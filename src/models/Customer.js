import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      default: "",
      trim: true
    },
    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true
    },

    preferredBarber: {
      type: String,
      default: "",
      trim: true
    },

    preferredLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null
    },

    marketingEmailOptIn: {
      type: Boolean,
      default: false
    },

    marketingSmsOptIn: {
      type: Boolean,
      default: false
    },

    notes: {
      type: String,
      default: "",
      trim: true
    },

    completedVisits: {
      type: Number,
      default: 0
    },

    cancelledVisits: {
      type: Number,
      default: 0
    },

    noShowCount: {
      type: Number,
      default: 0
    },

    loyaltyPoints: {
      type: Number,
      default: 0
    },

    loyaltyVisitsProgress: {
      type: Number,
      default: 0
    },

    totalSpend: {
      type: Number,
      default: 0
    },

    isActive: {
      type: Boolean,
      default: true
    },

    lastVerifiedMethod: {
      type: String,
      enum: ["phone", "email", ""],
      default: ""
    },

    lastVerifiedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

customerSchema.index({ phone: 1 });
customerSchema.index({ email: 1 });

const Customer = mongoose.model("Customer", customerSchema);

export default Customer;
