const express = require("express");
const client = require("prom-client");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { PubSub } = require("@google-cloud/pubsub");
const app = express();
const cors = require("cors");
const PORT = process.env.PORT || 3005;
app.use(cors());

app.use(express.json());

const collectDefaultMetrics = client.collectDefaultMetrics;

// Metrics endpoint
const register = new client.Registry();
collectDefaultMetrics({ register });

// Define custom metrics
const pubSubLatencyHistogram = new client.Histogram({
  name: "pub_sub_latency",
  help: "Histogram of Pub/Sub latency",
  labelNames: ["method"],
  buckets: [0.1, 5, 15, 50, 100, 500], // Example buckets in milliseconds
});
const individualLatencyGauge = new client.Gauge({
  name: "individual_pub_sub_latency",
  help: "Individual Pub/Sub latency",
});

const totalLatencyHistogram = new client.Histogram({
  name: "total_latency",
  help: "Histogram of total processing latency",
  labelNames: ["method"],
  buckets: [0.1, 5, 15, 50, 100, 500], // Example buckets in milliseconds
});
const totalLatencyGauge = new client.Gauge({
  name: "api_latency",
  help: "Api latency",
});

register.registerMetric(pubSubLatencyHistogram);
register.registerMetric(totalLatencyHistogram);
register.registerMetric(totalLatencyGauge);
register.registerMetric(individualLatencyGauge);
// Initialize Pub/Sub client
const pubSubClient = new PubSub({
  projectId: "notifyspherepoc",
  keyFilename: "./service-key.json",
});

// Open database connection
async function initDb() {
  return open({
    filename: "./mylocaldb.db",
    driver: sqlite3.Database,
  });
}

// Endpoint: Get completed orders
app.get("/api/getCompletedOrders", async (req, res) => {
  const db = await initDb();
  try {
    const orders = await db.all("SELECT * FROM orders ORDER BY id DESC");
    const deserializedOrders = orders.map((order) => ({
      ...order,
      items: JSON.parse(order.items),
      storeMetadata: JSON.parse(order.storeMetadata),
    }));
    res.json(deserializedOrders);
  } catch (error) {
    console.error("Failed to retrieve orders:", error);
    res.status(500).json({ error: "Failed to load orders." });
  }
});

// Endpoint: Get menu items
app.get("/api/menuItems", async (req, res) => {
  const db = await initDb();
  try {
    const menuItems = await db.all("SELECT * FROM menu_items");
    res.status(200).json(menuItems);
  } catch (error) {
    console.error("Failed to fetch menu items:", error);
    res
      .status(500)
      .json({ error: "Failed to load menu items from the database." });
  }
});

app.post("/api/submitOrder", async (req, res) => {
  const db = await initDb();
  const { items, totalPrice, storeMetadata, requestStartTime } = req.body;
  const serializedItems = JSON.stringify(items);
  const serializedStoreMetadata = JSON.stringify(storeMetadata);

  try {
    // Calculate Pub/Sub latency
    const pubSubStartTime = Date.now();
    const messageId = await pubSubClient
      .topic("TopicRegionSouthAmerica")
      .publish(
        Buffer.from(JSON.stringify({ items, totalPrice, storeMetadata }))
      );
    const pubSubEndTime = Date.now();
    const pubSubLatency = pubSubEndTime - pubSubStartTime;
    const totalEndTime = Date.now();
    const totalLatency = totalEndTime - requestStartTime;
    // Insert into database
    const result = await db.run(
      "INSERT INTO orders (items, totalPrice, storeMetadata, latency,latency1) VALUES (?, ?, ?, ?,?)",
      serializedItems,
      totalPrice,
      serializedStoreMetadata,
      `${pubSubLatency} ms`,
      `${totalLatency} ms`
    );
    pubSubLatencyHistogram.observe(pubSubLatency);
    totalLatencyHistogram.observe(totalLatency);
    individualLatencyGauge.set(pubSubLatency);
    totalLatencyGauge.set(totalLatency);
    res.status(200).json({
      message: "Order successfully published",
      orderId: result.lastID,
      pubSubLatency: `${pubSubLatency} ms`, // Pub/Sub operation latency
      totalLatency: `${totalLatency} ms`, // Total round-trip latency
    });
  } catch (error) {
    console.error(`Error processing your order: ${error.message}`);
    res
      .status(500)
      .json({ error: `Error processing your order: ${error.message}` });
  }
});
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => console.log(`API service running on port ${PORT}`));
