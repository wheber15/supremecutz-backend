import mongoose from "mongoose";

const galleryImageSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "",
      trim: true
    },
    description: {
      type: String,
      default: "",
      trim: true
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true
    },
    imagePath: {
      type: String,
      required: true,
      trim: true
    },
    locationIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Location"
      }
    ],
    showOnHomepage: {
      type: Boolean,
      default: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    sortOrder: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

const GalleryImage = mongoose.model("GalleryImage", galleryImageSchema);

export default GalleryImage;