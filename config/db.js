import mongoose from "mongoose";

/**
 * Resolve the single authoritative MongoDB URI.
 *
 * MONGODB_URI wins when both are set, but the selection is always reported so
 * two environments can never silently diverge without a visible warning.
 * Variable names are logged; values never are.
 */
function resolveMongoUri() {
  const primary = String(process.env.MONGODB_URI || "").trim();
  const legacy = String(process.env.MONGO_URI || "").trim();

  if (primary && legacy && primary !== legacy) {
    console.warn(
      "WARNING: Both MONGO_URI and MONGODB_URI are defined and differ.",
    );
    console.warn(
      "Using MONGODB_URI. MONGO_URI is ignored. Run scripts/diagnose-production-billing.mjs in each environment and compare the database fingerprints.",
    );
  }

  if (primary || legacy) {
    console.log(
      `MongoDB URI source: ${primary ? "MONGODB_URI" : "MONGO_URI"}`,
    );
    return primary || legacy;
  }

  // A localhost fallback in production writes to a database nobody deployed.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No MongoDB URI configured. Set MONGODB_URI (preferred) or MONGO_URI; refusing to fall back to a local database in production.",
    );
  }

  console.warn(
    "WARNING: No MongoDB URI configured; using local mongodb://127.0.0.1/canteen_orders.",
  );
  return "mongodb://127.0.0.1:27017/canteen_orders";
}

const connectDb = async () => {
  const uri = resolveMongoUri();
  try {

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