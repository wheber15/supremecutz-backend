import mongoose from "mongoose";

const serviceSchema = new mongoose.Schema(
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
    price: {
      type: Number,
      required: true,
      default: 0
    },
    durationMinutes: {
      type: Number,
      required: true,
      default: 30
    },
    description: {
      type: String,
      default: "",
      trim: true
    },
    image: {
      type: String,
      default: "",
      trim: true
    },
    imagePath: {
      type: String,
      default: "",
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    showOnHomepage: {
      type: Boolean,
      default: true
    },
    showInBooking: {
      type: Boolean,
      default: true
    },
    sortOrder: {
      type: Number,
      default: 0
    },
    locationIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Location"
      }
    ]
  },
  {
    timestamps: true
  }
);

const Service = mongoose.model("Service", serviceSchema);

export default Service;