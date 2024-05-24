const express = require("express");
const client = require("prom-client");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const http = require("http");
const WebSocket = require("ws");
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
const uiLatencyGauge = new client.Gauge({
  name: "ui_latency",
  help: "UI latency",
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

register.registerMetric(uiLatencyGauge);
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
  console.log("Received request for /api/getCompletedOrders");
  const db = await initDb();
  console.log("Database connection opened for /api/getCompletedOrders");
  try {
    const orders = await db.all("SELECT * FROM orders ORDER BY id DESC");
    console.log(`Retrieved ${orders.length} orders from database`);
    const deserializedOrders = orders.map((order) => ({
      ...order,
      items: JSON.parse(order.items),
      storeMetadata: JSON.parse(order.storeMetadata),
    }));
    res.json(deserializedOrders);
    console.log("Sent deserialized orders response");
  } catch (error) {
    console.error("Failed to retrieve orders:", error);
    res.status(500).json({ error: "Failed to load orders." });
  }
});

// Endpoint: Get menu items
app.get("/api/menuItems", async (req, res) => {
  console.log("Received request for /api/menuItems");
  const db = await initDb();
  console.log("Database connection opened for /api/menuItems");
  try {
    const menuItems = await db.all("SELECT * FROM menu_items");
    console.log(`Retrieved ${menuItems.length} menu items from database`);
    res.status(200).json(menuItems);
    console.log("Sent menu items response");
  } catch (error) {
    console.error("Failed to fetch menu items:", error);
    res
      .status(500)
      .json({ error: "Failed to load menu items from the database." });
  }
});
let lastOrderTimestamp = Date.now();
app.post("/api/submitOrder", async (req, res) => {
  console.log("Received request for /api/submitOrder");

  const apiProcessingStartTime = Date.now(); // Capture time at the start of API processing
  console.log("API processing started for /api/submitOrder");
  const db = await initDb();
  const { items, totalPrice, storeMetadata, requestStartTime } = req.body;
  const serializedItems = JSON.stringify(items);
  const serializedStoreMetadata = JSON.stringify(storeMetadata);

  try {
    console.log("Publishing message to Pub/Sub");

    const pubSubStartTime = Date.now();
    const messageId = await pubSubClient
      .topic("TopicRegionUSA")
      .publish(
        Buffer.from(JSON.stringify({ items, totalPrice, storeMetadata }))
      );
    const pubSubEndTime = Date.now();
    console.log("Message published to Pub/Sub");

    const pubSubLatency = pubSubEndTime - pubSubStartTime;

    // UI to API Latency (calculated as the difference between API processing start time and request start time sent from UI)
    const uiToApiLatency = apiProcessingStartTime - requestStartTime;
    // Total Round-trip Latency (calculated as the difference between total end time and request start time sent from UI)
    const totalEndTime = Date.now();
    const totalRoundTripLatency = totalEndTime - requestStartTime;
    console.log(`Pub/Sub Latency: ${pubSubLatency}ms`);
    console.log(`UI to API Latency: ${uiToApiLatency}ms`);
    console.log(`Total Round-Trip Latency: ${totalRoundTripLatency}ms`);

    // Insert into database
    const result = await db.run(
      "INSERT INTO orders (items, totalPrice, storeMetadata, latency, latency1) VALUES (?, ?, ?, ?, ?)",
      serializedItems,
      totalPrice,
      serializedStoreMetadata,
      `${pubSubLatency} ms`, // This is the API to Pub/Sub latency
      `${totalRoundTripLatency} ms` // This is the total round-trip latency
    );
    console.log("Order inserted into database");

    // Observing the calculated latencies
    pubSubLatencyHistogram.observe(pubSubLatency);
    totalLatencyHistogram.observe(totalRoundTripLatency);
    totalLatencyGauge.set(totalRoundTripLatency);
    individualLatencyGauge.set(pubSubLatency);
    uiLatencyGauge.set(uiToApiLatency);

    // Responding with the calculated latencies
    res.status(200).json({
      message: "Order successfully published",
      orderId: result.lastID,
      containerLatency: `${uiToApiLatency} ms`, // UI to API latency
      pubSubLatency: `${pubSubLatency} ms`, // API to Pub/Sub latency
      totalRoundTripLatency: `${totalRoundTripLatency} ms`, // Total round-trip latency
    });
    lastOrderTimestamp = Date.now();
    console.log("Sent response for /api/submitOrder");
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
const subscriptionName = "store1-sub";
const menuUpdateSubscription = pubSubClient.subscription(subscriptionName);

const updateMenuItemPriceInDb = async (itemName, newItemPrice) => {
  const db = await initDb();
  await db.run(
    "UPDATE menu_items SET price = ? WHERE name = ?",
    newItemPrice,
    itemName
  );
};

menuUpdateSubscription.on("message", async (message) => {
  console.log("Received message:", message.data.toString());
  const messageData = JSON.parse(message.data.toString());

  // Check if both name and price are present in the message
  if (!messageData || !messageData.name || messageData.price === undefined) {
    console.error("Message is missing required fields (name and/or price).");
    message.nack();
    return;
  }

  const { name, price } = messageData;

  // Additional validation for price could be performed here

  try {
    await updateMenuItemPriceInDb(name, price);
    console.log(`Updated price for ${name} to ${price}`);
    // Broadcast the update to all WebSocket clients
    broadcastUpdate({ message: `Updated price for ${name} to ${price}` });
    message.ack();
  } catch (error) {
    console.error("Failed to update database:", error);
    message.nack();
  }
});

// Create an HTTP server from the Express app
const server = http.createServer(app);

// Setup WebSocket server
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("WebSocket connection established");
});

// Function to broadcast updates to all connected WebSocket clients
const broadcastUpdate = (data) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
};
const IDLE_THRESHOLD = 2000; // 1 second

setInterval(() => {
  if (Date.now() - lastOrderTimestamp > IDLE_THRESHOLD) {
    // Reset the gauges if no new orders have been submitted within the last second
    totalLatencyGauge.set(0);
    individualLatencyGauge.set(0);
    uiLatencyGauge.set(0);
    console.log("Metrics reset due to inactivity.");
  }
}, 2000); // Check every 1 second

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
