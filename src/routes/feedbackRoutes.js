import express from "express";
import Feedback from "../models/Feedback.js";
import Booking from "../models/Booking.js";

const router = express.Router();

router.get("/analytics", async (_req, res) => {
  try {
    const feedback = await Feedback.find().sort({ createdAt: -1 });

    const totalReviews = feedback.length;

    const average = (arr, key) => {
      if (!arr.length) return 0;
      return (
        arr.reduce((sum, item) => sum + Number(item[key] || 0), 0) / arr.length
      );
    };

    const avgOverall = average(feedback, "overallRating");
    const avgHaircut = average(feedback, "haircutRating");
    const avgBarber = average(feedback, "barberRating");
    const avgCleanliness = average(feedback, "cleanlinessRating");

    const recommendCount = feedback.filter((item) => item.wouldRecommend).length;
    const recommendRate = totalReviews
      ? Math.round((recommendCount / totalReviews) * 100)
      : 0;

    const barberMap = new Map();

    for (const item of feedback) {
      const key = item.barber || "Unknown";
      if (!barberMap.has(key)) {
        barberMap.set(key, {
          barber: key,
          totalReviews: 0,
          overallTotal: 0,
          haircutTotal: 0,
          barberTotal: 0,
          cleanlinessTotal: 0,
          recommendCount: 0
        });
      }

      const row = barberMap.get(key);
      row.totalReviews += 1;
      row.overallTotal += Number(item.overallRating || 0);
      row.haircutTotal += Number(item.haircutRating || 0);
      row.barberTotal += Number(item.barberRating || 0);
      row.cleanlinessTotal += Number(item.cleanlinessRating || 0);
      if (item.wouldRecommend) row.recommendCount += 1;
    }

    const barberPerformance = Array.from(barberMap.values())
      .map((item) => ({
        barber: item.barber,
        totalReviews: item.totalReviews,
        avgOverall: Number((item.overallTotal / item.totalReviews).toFixed(1)),
        avgHaircut: Number((item.haircutTotal / item.totalReviews).toFixed(1)),
        avgBarber: Number((item.barberTotal / item.totalReviews).toFixed(1)),
        avgCleanliness: Number(
          (item.cleanlinessTotal / item.totalReviews).toFixed(1)
        ),
        recommendRate: Math.round(
          (item.recommendCount / item.totalReviews) * 100
        )
      }))
      .sort((a, b) => b.avgOverall - a.avgOverall);

    const recentComments = feedback
      .filter((item) => item.comment && item.comment.trim())
      .slice(0, 8)
      .map((item) => ({
        _id: item._id,
        customerName: item.customerName,
        barber: item.barber,
        location: item.location,
        overallRating: item.overallRating,
        comment: item.comment,
        createdAt: item.createdAt
      }));

    res.json({
      totalReviews,
      avgOverall: Number(avgOverall.toFixed(1)),
      avgHaircut: Number(avgHaircut.toFixed(1)),
      avgBarber: Number(avgBarber.toFixed(1)),
      avgCleanliness: Number(avgCleanliness.toFixed(1)),
      recommendRate,
      barberPerformance,
      recentComments
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch feedback analytics",
      error: error.message
    });
  }
});

router.get("/", async (_req, res) => {
  try {
    const feedback = await Feedback.find().sort({ createdAt: -1 });
    res.json(feedback);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch feedback",
      error: error.message
    });
  }
});

router.get("/booking/:bookingId", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const existingFeedback = await Feedback.findOne({
      bookingId: req.params.bookingId
    });

    res.json({
      booking,
      alreadySubmitted: !!existingFeedback,
      feedback: existingFeedback || null
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to load feedback page",
      error: error.message
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      bookingId,
      overallRating,
      haircutRating,
      barberRating,
      cleanlinessRating,
      wouldRecommend,
      comment
    } = req.body;

    if (
      !bookingId ||
      !overallRating ||
      !haircutRating ||
      !barberRating ||
      !cleanlinessRating ||
      typeof wouldRecommend !== "boolean"
    ) {
      return res.status(400).json({
        message: "Please complete all required feedback fields"
      });
    }

    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    const existingFeedback = await Feedback.findOne({ bookingId });

    if (existingFeedback) {
      return res.status(409).json({
        message: "Feedback already submitted for this booking"
      });
    }

    const feedback = await Feedback.create({
      bookingId,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      barber: booking.barber,
      location: booking.location,
      service: booking.service,
      overallRating,
      haircutRating,
      barberRating,
      cleanlinessRating,
      wouldRecommend,
      comment: comment || ""
    });

    res.status(201).json({
      message: "Feedback submitted successfully",
      feedback
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to submit feedback",
      error: error.message
    });
  }
});

export default router;