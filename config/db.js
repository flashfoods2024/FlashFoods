import mongoose from "mongoose";

const connectDb = async () => {
  try {
    const uri =
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      "mongodb://127.0.0.1:27017/canteen_orders";

    if (
      process.env.MONGODB_URI &&
      process.env.MONGO_URI &&
      process.env.MONGODB_URI !== process.env.MONGO_URI
    ) {
      console.warn(
        "WARNING: Both MONGO_URI and MONGODB_URI are defined and differ.",
      );
      console.warn("Using MONGODB_URI. MONGO_URI is ignored.");
    }

    // Fail fast instead of buffering operations forever
    mongoose.set("bufferCommands", false);

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 20000,
      family: 4,
    });

    console.log(
      "MongoDB connected:",
      mongoose.connection.host,
      "-",
      mongoose.connection.name,
    );
    return true;
  } catch (error) {
    console.error("DB connection error:", error?.message || error);
    throw error;
  }
};

export default connectDb;