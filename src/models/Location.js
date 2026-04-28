import mongoose from "mongoose";

const openingHoursSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      required: true,
      enum: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday"
      ]
    },
    isActive: {
      type: Boolean,
      default: true
    },
    open: {
      type: String,
      default: "09:00"
    },
    close: {
      type: String,
      default: "18:00"
    }
  },
  { _id: false }
);

const customSlotRuleSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      default: ""
    },
    day: {
      type: String,
      enum: [
        "",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday"
      ],
      default: ""
    },
    slots: {
      type: [String],
      default: []
    }
  },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    addressLine1: {
      type: String,
      default: "",
      trim: true
    },
    addressLine2: {
      type: String,
      default: "",
      trim: true
    },
    city: {
      type: String,
      default: "",
      trim: true
    },
    county: {
      type: String,
      default: "",
      trim: true
    },
    postcode: {
      type: String,
      default: "",
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
      trim: true
    },
    description: {
      type: String,
      default: "",
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    openingHours: {
      type: [openingHoursSchema],
      default: [
        { day: "monday", isActive: true, open: "09:00", close: "18:00" },
        { day: "tuesday", isActive: true, open: "09:00", close: "18:00" },
        { day: "wednesday", isActive: true, open: "09:00", close: "18:00" },
        { day: "thursday", isActive: true, open: "09:00", close: "18:00" },
        { day: "friday", isActive: true, open: "09:00", close: "18:00" },
        { day: "saturday", isActive: true, open: "09:00", close: "18:00" },
        { day: "sunday", isActive: false, open: "09:00", close: "18:00" }
      ]
    },
    blockedDates: {
      type: [String],
      default: []
    },
    slotIntervalMinutes: {
      type: Number,
      default: 30
    },
    customSlots: {
      type: [customSlotRuleSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

const Location = mongoose.model("Location", locationSchema);

export default Location;