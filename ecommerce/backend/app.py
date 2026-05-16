import logging
import atexit
import signal
import sys
import traceback
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, request
from flask_cors import CORS

# ── Logging Setup ──────────────────────────────────────────────────────────────
# Absolute path so the log always lands in the backend/ folder, regardless of cwd
LOG_FILE = str(Path(__file__).parent / "server.log")

# Clear log on every start
with open(LOG_FILE, "w") as f:
    f.write("")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("shopkiro")

# ── Redirect ALL stderr (Python tracebacks) to log file too ───────────────────
import re as _re

def _strip_ansi(text: str) -> str:
    """Remove ANSI terminal escape codes from a string."""
    return _re.sub(r'\x1b\[[0-9;]*m', '', text)

class StderrToLog:
    def write(self, msg):
        clean = _strip_ansi(msg).strip()
        if clean:
            logger.error("STDERR: %s", clean)
    def flush(self):
        pass

sys.stderr = StderrToLog()

# ── Catch any unhandled exception and write full traceback to log ──────────────
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

@app.errorhandler(404)
def handle_not_found(e):
    logger.warning("NOT FOUND  |  %s %s", request.method, request.path)
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def handle_method_not_allowed(e):
    logger.warning("METHOD NOT ALLOWED  |  %s %s", request.method, request.path)
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(Exception)
def handle_route_exception(e):
    # Let HTTP exceptions (4xx) pass through with their correct status code
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return jsonify({"error": e.description}), e.code
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
@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "ecommerce-flask",
        "status": "running",
        "endpoints": [
            "GET  /api/products",
            "GET  /api/products/<id>",
            "GET  /api/categories",
            "GET  /api/orders",
            "POST /api/orders",
        ]
    })


@app.route("/favicon.ico")
def favicon():
    return "", 204


@app.route("/api/client-error", methods=["POST"])
def client_error():
    """Receives client-side JS errors from the frontend and writes them to the log."""
    data = request.get_json(silent=True) or {}
    error_type = data.get("type", "CLIENT_ERROR")
    message    = data.get("message", "unknown error")
    source     = data.get("source", "")
    lineno     = data.get("lineno", "")
    colno      = data.get("colno", "")
    stack      = data.get("stack", "")
    url        = data.get("url", "")
    user_agent = request.headers.get("User-Agent", "")

    logger.error(
        "CLIENT_ERROR  |  type=%s  msg=%s  source=%s  line=%s  col=%s  url=%s  ua=%s",
        error_type, message, source, lineno, colno, url, user_agent
    )
    if stack:
        logger.error("CLIENT_STACK  |  %s", stack[:800])

    return jsonify({"received": True}), 200


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
        logger.info("Log file: %s", LOG_FILE)
        logger.info("=" * 60)
        app.run(debug=False, port=5000)
    except Exception:
        logger.critical("SERVER CRASHED ON STARTUP:\n%s", traceback.format_exc())
        sys.exit(1)