import logging
import atexit
import signal
import sys
import traceback
import threading
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS

# ── Logging Setup ──────────────────────────────────────────────────────────────
LOG_FILE = "server.log"

# Clear log on every start
with open(LOG_FILE, "w") as f:
    f.write("")

file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
file_handler.setFormatter(logging.Formatter(
    "%(asctime)s  [%(levelname)s]  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        file_handler,
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("shopkiro")

# ── Clear log file every 15 seconds (keeps server running) ────────────────────
def clear_log_periodically():
    while True:
        threading.Event().wait(60)
        try:
            file_handler.stream.seek(0)
            file_handler.stream.truncate(0)
            logger.info("LOG CLEARED  |  auto-cleared every 15 seconds  |  %s",
                        datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        except Exception:
            pass

log_cleaner = threading.Thread(target=clear_log_periodically, daemon=True)
log_cleaner.start()

# ── Redirect ALL stderr to log ─────────────────────────────────────────────────
class StderrToLog:
    def write(self, msg):
        if msg.strip():
            logger.error("STDERR: %s", msg.strip())
    def flush(self):
        pass

sys.stderr = StderrToLog()

# ── Catch unhandled exceptions ─────────────────────────────────────────────────
def handle_exception(exc_type, exc_value, exc_tb):
    tb_str = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    logger.critical("UNHANDLED EXCEPTION:\n%s", tb_str)

sys.excepthook = handle_exception

# ── Flask App ──────────────────────────────────────────────────────────────────
try:
    app = Flask(__name__)
    CORS(app)
except Exception:
    logger.critical("FAILED TO INIT FLASK:\n%s", traceback.format_exc())
    sys.exit(1)

# ── Request / Response Logging ─────────────────────────────────────────────────
@app.before_request
def log_request():
    logger.info("REQUEST  %s %s  |  IP: %s  |  Body: %s",
                request.method, request.path,
                request.remote_addr,
                request.get_data(as_text=True) or "-")

@app.after_request
def log_response(response):
    logger.info("RESPONSE %s %s  |  Status: %s",
                request.method, request.path, response.status)
    return response

@app.errorhandler(Exception)
def handle_route_exception(e):
    logger.error("ROUTE EXCEPTION  |  %s %s  |  %s",
                 request.method, request.path, traceback.format_exc())
    return jsonify({"error": "Internal server error"}), 500

# ── In-memory data store ───────────────────────────────────────────────────────
products = [
    {"id": 1, "name": "Wireless Headphones", "price": 79.99, "image": "https://placehold.co/300x200?text=Headphones", "category": "Electronics", "stock": 15, "description": "High-quality wireless headphones with noise cancellation."},
    {"id": 2, "name": "Running Shoes",        "price": 59.99, "image": "https://placehold.co/300x200?text=Shoes",        "category": "Footwear",     "stock": 30, "description": "Lightweight and comfortable running shoes for all terrains."},
    {"id": 3, "name": "Coffee Maker",         "price": 49.99, "image": "https://placehold.co/300x200?text=Coffee+Maker", "category": "Kitchen",      "stock": 10, "description": "Brew the perfect cup every morning with this compact coffee maker."},
    {"id": 4, "name": "Yoga Mat",             "price": 29.99, "image": "https://placehold.co/300x200?text=Yoga+Mat",     "category": "Sports",       "stock": 25, "description": "Non-slip, eco-friendly yoga mat for all skill levels."},
    {"id": 5, "name": "Backpack",             "price": 44.99, "image": "https://placehold.co/300x200?text=Backpack",     "category": "Accessories",  "stock": 20, "description": "Durable 30L backpack with laptop compartment and USB charging port."},
    {"id": 6, "name": "Desk Lamp",            "price": 34.99, "image": "https://placehold.co/300x200?text=Desk+Lamp",    "category": "Electronics",  "stock": 18, "description": "LED desk lamp with adjustable brightness and color temperature."},
    {"id": 7, "name": "Water Bottle",         "price": 19.99, "image": "https://placehold.co/300x200?text=Water+Bottle", "category": "Sports",       "stock": 50, "description": "Insulated stainless steel water bottle, keeps drinks cold for 24 hours."},
    {"id": 8, "name": "Sunglasses",           "price": 24.99, "image": "https://placehold.co/300x200?text=Sunglasses",   "category": "Accessories",  "stock": 35, "description": "UV400 polarized sunglasses with lightweight frame."},
]

orders = []
next_order_id = 1

# ── Routes ─────────────────────────────────────────────────────────────────────
@app.route("/api/products", methods=["GET"])
def get_products():
    category = request.args.get("category")
    search = request.args.get("search", "").lower()
    result = products
    if category and category != "All":
        result = [p for p in result if p["category"] == category]
    if search:
        result = [p for p in result if search in p["name"].lower() or search in p["description"].lower()]
    logger.info("PRODUCTS fetched  |  category=%s  search=%s  count=%d", category or "All", search or "-", len(result))
    return jsonify(result)


@app.route("/api/products/<int:product_id>", methods=["GET"])
def get_product(product_id):
    product = next((p for p in products if p["id"] == product_id), None)
    if not product:
        logger.warning("PRODUCT NOT FOUND  |  id=%d", product_id)
        return jsonify({"error": "Product not found"}), 404
    logger.info("PRODUCT fetched  |  id=%d  name=%s", product_id, product["name"])
    return jsonify(product)


@app.route("/api/categories", methods=["GET"])
def get_categories():
    cats = ["All"] + sorted(set(p["category"] for p in products))
    logger.info("CATEGORIES fetched  |  %s", cats)
    return jsonify(cats)


@app.route("/api/orders", methods=["POST"])
def create_order():
    global next_order_id
    data = request.get_json()

    if not data or not data.get("items") or not data.get("customer"):
        logger.warning("ORDER FAILED  |  reason=Invalid order data")
        return jsonify({"error": "Invalid order data"}), 400

    customer = data["customer"]
    required_fields = ["name", "email", "address"]
    for field in required_fields:
        if not customer.get(field):
            logger.warning("ORDER FAILED  |  reason=Missing customer field: %s", field)
            return jsonify({"error": f"Missing customer field: {field}"}), 400

    items = data["items"]
    total = 0
    order_items = []

    for item in items:
        product = next((p for p in products if p["id"] == item["id"]), None)
        if not product:
            logger.warning("ORDER FAILED  |  reason=Product not found  id=%s", item["id"])
            return jsonify({"error": f"Product {item['id']} not found"}), 404
        qty = item.get("quantity", 1)
        if qty < 1:
            logger.warning("ORDER FAILED  |  reason=Invalid quantity  qty=%d", qty)
            return jsonify({"error": "Quantity must be at least 1"}), 400
        if product["stock"] < qty:
            logger.warning("ORDER FAILED  |  reason=Insufficient stock  product=%s  requested=%d  available=%d",
                           product["name"], qty, product["stock"])
            return jsonify({"error": f"Insufficient stock for {product['name']}"}), 400
        subtotal = product["price"] * qty
        total += subtotal
        order_items.append({
            "product_id": product["id"],
            "name": product["name"],
            "price": product["price"],
            "quantity": qty,
            "subtotal": round(subtotal, 2),
        })
        product["stock"] -= qty
        logger.info("STOCK UPDATED  |  product=%s  sold=%d  remaining=%d",
                    product["name"], qty, product["stock"])

    order = {
        "id": next_order_id,
        "customer": customer,
        "items": order_items,
        "total": round(total, 2),
        "status": "confirmed",
    }
    orders.append(order)
    next_order_id += 1

    logger.info("ORDER PLACED  |  order_id=%d  customer=%s  email=%s  total=$%.2f  items=%d",
                order["id"], customer["name"], customer["email"], order["total"], len(order_items))
    return jsonify({"message": "Order placed successfully!", "order": order}), 201


@app.route("/api/orders", methods=["GET"])
def get_orders():
    logger.info("ORDERS fetched  |  count=%d", len(orders))
    return jsonify(orders)


# ── Startup Demo Errors ────────────────────────────────────────────────────────
def run_startup_checks():
    """Simulate 3 startup checks — logs warnings/errors so you can see them immediately."""

    # Check 1: Warn if product stock is low
    low_stock = [p for p in products if p["stock"] < 12]
    if low_stock:
        for p in low_stock:
            logger.warning("STARTUP CHECK  |  Low stock warning  |  product='%s'  stock=%d",
                           p["name"], p["stock"])
    else:
        logger.info("STARTUP CHECK  |  Stock levels OK")

    # Check 2: Simulate a config value missing (demo error)
    DB_URL = None  # pretend this was supposed to be set
    if not DB_URL:
        logger.error("STARTUP CHECK  |  CONFIG ERROR  |  DB_URL is not set — using in-memory store as fallback")

    # Check 3: Simulate a failed external service ping (demo critical)
    try:
        raise ConnectionRefusedError("Payment gateway unreachable at startup")
    except ConnectionRefusedError as e:
        logger.critical("STARTUP CHECK  |  EXTERNAL SERVICE FAILED  |  %s  |  Continuing without payment service", e)


# ── Server Lifecycle ───────────────────────────────────────────────────────────
def on_shutdown():
    logger.info("=" * 60)
    logger.info("SERVER STOPPED  |  %s", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    logger.info("=" * 60)

atexit.register(on_shutdown)

def handle_sigint(sig, frame):
    logger.info("SERVER INTERRUPTED  |  signal=SIGINT (Ctrl+C)")
    sys.exit(0)

signal.signal(signal.SIGINT, handle_sigint)


if __name__ == "__main__":
    try:
        logger.info("=" * 60)
        logger.info("SERVER STARTED  |  %s", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        logger.info("Listening on http://localhost:5000")
        logger.info("Log file: %s  |  clears every 15 seconds", LOG_FILE)
        logger.info("=" * 60)

        # Run startup checks — shows demo warnings/errors immediately
        run_startup_checks()

        logger.info("-" * 60)
        logger.info("Startup checks complete. Server is ready.")
        logger.info("-" * 60)

        app.run(debug=False, port=5000)
    except Exception:
        logger.critical("SERVER CRASHED ON STARTUP:\n%s", traceback.format_exc())
        sys.exit(1)