const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./mylocaldb.db");

db.serialize(() => {
  // Create the menu_items table
  db.run(`CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL
  )`);

  // Insert some initial items
  const items = [
    { name: "Big Mac", price: 5.99 },
    { name: "McChicken", price: 4.99 },
    { name: "Filet-O-Fish", price: 5.49 },
    { name: "Spicy McCrispy", price: 5.99 },
    { name: "Quarter Pounder with Cheese", price: 5.79 },
    { name: "Chicken McNuggets (10 pcs)", price: 4.49 },
    { name: "World Famous Fries (Medium)", price: 2.19 },
    { name: "McDouble", price: 2.0 },
    { name: "Bacon, Egg & Cheese Biscuit", price: 3.19 },
    { name: "Egg McMuffin", price: 3.59 },
    { name: "Sausage Burrito", price: 1.29 },
    { name: "Hotcakes", price: 3.19 },
    { name: "Apple Pie", price: 1.49 },
    { name: "Vanilla Cone", price: 1.0 },
    { name: "Strawberry Shake (Medium)", price: 2.99 },
    { name: "Mocha Frappe (Medium)", price: 3.39 },
    { name: "Iced Caramel Macchiato (Medium)", price: 3.39 },
    { name: "Sweet Tea (Large)", price: 1.0 },
    { name: "Coca-Cola (Large)", price: 1.89 },
  ];
  const stmt = db.prepare("INSERT INTO menu_items (name, price) VALUES (?, ?)");
  items.forEach(({ name, price }) => {
    stmt.run(name, price);
  });
  stmt.finalize();

  // Create the orders table
  db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      items TEXT NOT NULL,
      totalPrice REAL NOT NULL,
      storeMetadata TEXT NOT NULL,
      latency TEXT,
      latency1 TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
});

db.close();
