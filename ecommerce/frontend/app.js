const API = "http://localhost:5000/api";

// ── State ──
let allProducts = [];
let cart = JSON.parse(localStorage.getItem("cart") || "[]");
let activeCategory = "All";

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  loadCategories();
  loadProducts();
  renderCart();
});

// ── Page Navigation ──
function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  document.getElementById(`nav-${page}`).classList.add("active");
  if (page === "orders") loadOrders();
}

// ── Products ──
async function loadCategories() {
  try {
    const res = await fetch(`${API}/categories`);
    const cats = await res.json();
    const container = document.getElementById("category-list");
    container.innerHTML = cats.map(c =>
      `<button class="cat-btn ${c === "All" ? "active" : ""}" onclick="selectCategory('${c}')">${c}</button>`
    ).join("");
  } catch (e) {
    console.error("Failed to load categories", e);
  }
}

async function loadProducts() {
  try {
    const search = document.getElementById("search-input").value;
    const params = new URLSearchParams();
    if (activeCategory !== "All") params.set("category", activeCategory);
    if (search) params.set("search", search);

    const res = await fetch(`${API}/products?${params}`);
    allProducts = await res.json();
    renderProducts(allProducts);
  } catch (e) {
    document.getElementById("products-grid").innerHTML =
      `<div class="no-results">⚠️ Could not connect to the server. Make sure the backend is running.</div>`;
  }
}

function renderProducts(products) {
  const grid = document.getElementById("products-grid");
  if (!products.length) {
    grid.innerHTML = `<div class="no-results">No products found.</div>`;
    return;
  }
  grid.innerHTML = products.map(p => `
    <div class="product-card">
      <img src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" />
      <div class="product-info">
        <span class="product-category">${escapeHtml(p.category)}</span>
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-desc">${escapeHtml(p.description)}</div>
        <div class="product-footer">
          <span class="product-price">$${p.price.toFixed(2)}</span>
          <span class="product-stock">${p.stock > 0 ? `${p.stock} in stock` : "Out of stock"}</span>
        </div>
        <button
          class="add-to-cart-btn"
          onclick="addToCart(${p.id})"
          ${p.stock === 0 ? "disabled" : ""}
        >${p.stock === 0 ? "Out of Stock" : "Add to Cart"}</button>
      </div>
    </div>
  `).join("");
}

function selectCategory(cat) {
  activeCategory = cat;
  document.querySelectorAll(".cat-btn").forEach(b => {
    b.classList.toggle("active", b.textContent === cat);
  });
  loadProducts();
}

function filterProducts() {
  loadProducts();
}

// ── Cart ──
function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const existing = cart.find(i => i.id === productId);
  if (existing) {
    if (existing.quantity >= product.stock) {
      showToast("No more stock available.");
      return;
    }
    existing.quantity++;
  } else {
    cart.push({ id: product.id, name: product.name, price: product.price, image: product.image, quantity: 1 });
  }

  saveCart();
  renderCart();
  showToast(`"${product.name}" added to cart!`);
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== productId);
  saveCart();
  renderCart();
}

function updateQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(productId);
    return;
  }
  saveCart();
  renderCart();
}

function renderCart() {
  const container = document.getElementById("cart-items");
  const totalEl = document.getElementById("cart-total");
  const countEl = document.getElementById("cart-count");

  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
  countEl.textContent = totalItems;

  if (!cart.length) {
    container.innerHTML = `<div class="cart-empty">🛒 Your cart is empty.</div>`;
    totalEl.textContent = "$0.00";
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img src="${item.image}" alt="${escapeHtml(item.name)}" />
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">$${(item.price * item.quantity).toFixed(2)}</div>
        <div class="qty-controls">
          <button class="qty-btn" onclick="updateQty(${item.id}, -1)">−</button>
          <span class="qty-value">${item.quantity}</span>
          <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
        </div>
      </div>
      <button class="remove-btn" onclick="removeFromCart(${item.id})" title="Remove">🗑</button>
    </div>
  `).join("");

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  totalEl.textContent = `$${total.toFixed(2)}`;
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function toggleCart() {
  document.getElementById("cart-sidebar").classList.toggle("open");
  document.getElementById("cart-overlay").classList.toggle("open");
}

// ── Checkout ──
function showCheckout() {
  if (!cart.length) {
    showToast("Your cart is empty.");
    return;
  }
  toggleCart();
  renderOrderSummary();
  document.getElementById("modal-overlay").classList.add("open");
}

function closeCheckout() {
  document.getElementById("modal-overlay").classList.remove("open");
}

function renderOrderSummary() {
  const summary = document.getElementById("order-summary");
  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  summary.innerHTML = `
    <h3>Order Summary</h3>
    ${cart.map(i => `
      <div class="summary-item">
        <span>${escapeHtml(i.name)} × ${i.quantity}</span>
        <span>$${(i.price * i.quantity).toFixed(2)}</span>
      </div>
    `).join("")}
    <div class="summary-total">
      <span>Total</span>
      <span>$${total.toFixed(2)}</span>
    </div>
  `;
}

async function placeOrder(e) {
  e.preventDefault();
  const name = document.getElementById("cust-name").value.trim();
  const email = document.getElementById("cust-email").value.trim();
  const address = document.getElementById("cust-address").value.trim();

  const payload = {
    customer: { name, email, address },
    items: cart.map(i => ({ id: i.id, quantity: i.quantity })),
  };

  try {
    const res = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(`Error: ${data.error}`);
      return;
    }

    cart = [];
    saveCart();
    renderCart();
    closeCheckout();
    document.getElementById("checkout-form").reset();
    showToast(`Order #${data.order.id} placed! Total: $${data.order.total.toFixed(2)}`);
    // Refresh products to reflect updated stock
    loadProducts();
  } catch (err) {
    showToast("Could not connect to server. Please try again.");
  }
}

// ── Orders ──
async function loadOrders() {
  const container = document.getElementById("orders-list");
  container.innerHTML = `<div class="orders-empty">Loading...</div>`;
  try {
    const res = await fetch(`${API}/orders`);
    const orders = await res.json();
    if (!orders.length) {
      container.innerHTML = `<div class="orders-empty">No orders yet. Start shopping!</div>`;
      return;
    }
    container.innerHTML = orders.slice().reverse().map(o => `
      <div class="order-card">
        <div class="order-card-header">
          <span class="order-id">Order #${o.id}</span>
          <span class="order-status">${o.status}</span>
        </div>
        <div class="order-items-list">
          ${o.items.map(i => `${escapeHtml(i.name)} × ${i.quantity}`).join(", ")}
        </div>
        <div class="order-total">Total: $${o.total.toFixed(2)}</div>
        <div class="order-customer">📦 ${escapeHtml(o.customer.name)} — ${escapeHtml(o.customer.address)}</div>
      </div>
    `).join("");
  } catch (e) {
    container.innerHTML = `<div class="orders-empty">⚠️ Could not load orders.</div>`;
  }
}

// ── Toast ──
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// ── Helpers ──
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
