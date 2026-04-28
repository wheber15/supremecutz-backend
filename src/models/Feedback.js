import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true
    },
    customerName: {
      type: String,
      default: ""
    },
    customerEmail: {
      type: String,
      default: ""
    },
    barber: {
      type: String,
      default: ""
    },
    location: {
      type: String,
      default: ""
    },
    service: {
      type: String,
      default: ""
    },
    overallRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    haircutRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    barberRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    cleanlinessRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    wouldRecommend: {
      type: Boolean,
      required: true
    },
    comment: {
      type: String,
      default: "",
      trim: true
    }
  },
  {
    timestamps: true
  }
);

const Feedback = mongoose.model("Feedback", feedbackSchema);

export default Feedback;