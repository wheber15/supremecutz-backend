import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true
    },
    barber: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    bookingDate: {
      type: String,
      required: true
    },
    bookingTime: {
      type: String,
      required: true
    },
    customerName: {
      type: String,
      required: true,
      trim: true
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true
    },
    customerEmail: {
      type: String,
      default: "",
      trim: true
    },
    notes: {
      type: String,
      default: "",
      trim: true
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "cancelled"],
      default: "pending"
    },
    phoneVerified: {
      type: Boolean,
      default: false
    },
    emailVerified: {
      type: Boolean,
      default: false
    },
    verificationMethod: {
      type: String,
      enum: ["phone", "email", "legacy"],
      default: "legacy"
    },
    verifiedContact: {
      type: String,
      default: "",
      trim: true,
      lowercase: true
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true
    }
  },
  { timestamps: true }
);

bookingSchema.index({
  barber: 1,
  location: 1,
  bookingDate: 1,
  bookingTime: 1,
  status: 1
});

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;