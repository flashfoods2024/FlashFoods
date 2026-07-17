import mongoose from "mongoose";

const connectDb = async () => {
  try {
    const uri =
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      "mongodb://127.0.0.1:27017/canteen_orders";

    // Fail fast instead of buffering operations forever
    mongoose.set("bufferCommands", false);

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 20000,
      family: 4,
    });
    console.log("MongoDB connected");
    return true;
  } catch (error) {
    console.error("DB connection error:", error?.message || error);
    throw error;
  }
};

export default connectDb;