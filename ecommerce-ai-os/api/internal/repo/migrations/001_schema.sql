-- E-commerce AI OS — normalized multi-tenant schema.
-- Tenancy: organizations → stores → business data. Every business table is
-- keyed by (store_id, id) and every query filters by store_id, which the API
-- only resolves after verifying the store belongs to the caller's organization.

CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'owner',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_org_idx ON users(org_id);

CREATE TABLE IF NOT EXISTS stores (
    id             TEXT PRIMARY KEY,
    org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    platform       TEXT NOT NULL,
    business_type  TEXT NOT NULL,
    currency       TEXT NOT NULL DEFAULT 'INR',
    seeded_at      TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stores_org_idx ON stores(org_id);

CREATE TABLE IF NOT EXISTS products (
    store_id     TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id           TEXT NOT NULL,
    sku          TEXT NOT NULL,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL,
    price        NUMERIC(12,2) NOT NULL,
    cost         NUMERIC(12,2) NOT NULL,
    supplier     TEXT NOT NULL,
    launched_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, id)
);

CREATE TABLE IF NOT EXISTS customers (
    store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id          TEXT NOT NULL,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    phone       TEXT NOT NULL,
    city        TEXT NOT NULL,
    state       TEXT NOT NULL,
    region      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, id)
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
    store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id            TEXT NOT NULL,
    channel       TEXT NOT NULL,
    name          TEXT NOT NULL,
    objective     TEXT NOT NULL,
    status        TEXT NOT NULL,
    daily_budget  NUMERIC(12,2) NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, id)
);

CREATE TABLE IF NOT EXISTS orders (
    store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id              TEXT NOT NULL,
    number          TEXT NOT NULL,
    customer_id     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL,
    payment_method  TEXT NOT NULL,
    subtotal        NUMERIC(12,2) NOT NULL,
    discount        NUMERIC(12,2) NOT NULL,
    shipping_fee    NUMERIC(12,2) NOT NULL,
    total           NUMERIC(12,2) NOT NULL,
    campaign_id     TEXT,
    channel         TEXT NOT NULL,
    PRIMARY KEY (store_id, id),
    FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, id)
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(store_id, created_at);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(store_id, customer_id);

CREATE TABLE IF NOT EXISTS order_items (
    store_id    TEXT NOT NULL,
    order_id    TEXT NOT NULL,
    product_id  TEXT NOT NULL,
    qty         INT NOT NULL,
    unit_price  NUMERIC(12,2) NOT NULL,
    unit_cost   NUMERIC(12,2) NOT NULL,
    PRIMARY KEY (store_id, order_id, product_id),
    FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE CASCADE,
    FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id)
);

CREATE TABLE IF NOT EXISTS shipments (
    store_id      TEXT NOT NULL,
    order_id      TEXT NOT NULL,
    courier       TEXT NOT NULL,
    state         TEXT NOT NULL,
    region        TEXT NOT NULL,
    shipped_at    TIMESTAMPTZ,
    promised_at   TIMESTAMPTZ NOT NULL,
    delivered_at  TIMESTAMPTZ,
    ndr_attempts  INT NOT NULL DEFAULT 0,
    status        TEXT NOT NULL,
    cost          NUMERIC(12,2) NOT NULL,
    PRIMARY KEY (store_id, order_id),
    FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS returns (
    store_id    TEXT NOT NULL,
    id          TEXT NOT NULL,
    order_id    TEXT NOT NULL,
    product_id  TEXT NOT NULL,
    qty         INT NOT NULL,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, id),
    FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refunds (
    store_id    TEXT NOT NULL,
    id          TEXT NOT NULL,
    order_id    TEXT NOT NULL,
    return_id   TEXT,
    amount      NUMERIC(12,2) NOT NULL,
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, id),
    FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
    store_id     TEXT NOT NULL,
    id           TEXT NOT NULL,
    product_id   TEXT NOT NULL,
    customer_id  TEXT NOT NULL,
    order_id     TEXT NOT NULL,
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    source       TEXT NOT NULL,
    sentiment    TEXT NOT NULL,
    themes       TEXT[] NOT NULL,
    response     TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, id),
    FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id)
);

-- support_tickets holds every conversation; complaints is the subset flagged
-- as a complaint, with its triage cluster.
CREATE TABLE IF NOT EXISTS support_tickets (
    store_id           TEXT NOT NULL,
    id                 TEXT NOT NULL,
    customer_id        TEXT NOT NULL,
    order_id           TEXT,
    product_id         TEXT,
    channel            TEXT NOT NULL,
    category           TEXT NOT NULL,
    subject            TEXT NOT NULL,
    message            TEXT NOT NULL,
    priority           TEXT NOT NULL,
    status             TEXT NOT NULL,
    escalated          BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL,
    first_response_at  TIMESTAMPTZ,
    resolved_at        TIMESTAMPTZ,
    PRIMARY KEY (store_id, id)
);
CREATE INDEX IF NOT EXISTS tickets_created_idx ON support_tickets(store_id, created_at);

CREATE TABLE IF NOT EXISTS complaints (
    store_id     TEXT NOT NULL,
    ticket_id    TEXT NOT NULL,
    cluster_key  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (store_id, ticket_id),
    FOREIGN KEY (store_id, ticket_id) REFERENCES support_tickets(store_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory (
    store_id        TEXT NOT NULL,
    product_id      TEXT NOT NULL,
    warehouse       TEXT NOT NULL,
    on_hand         INT NOT NULL,
    reserved        INT NOT NULL,
    reorder_point   INT NOT NULL,
    lead_time_days  INT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, product_id),
    FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id)
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
    store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    units       INT NOT NULL,
    value       NUMERIC(14,2) NOT NULL,
    restocked   NUMERIC(14,2) NOT NULL,
    stockouts   INT NOT NULL,
    low_stock   INT NOT NULL,
    PRIMARY KEY (store_id, date)
);

CREATE TABLE IF NOT EXISTS marketing_metrics (
    store_id     TEXT NOT NULL,
    campaign_id  TEXT NOT NULL,
    date         DATE NOT NULL,
    spend        NUMERIC(12,2) NOT NULL,
    impressions  INT NOT NULL,
    clicks       INT NOT NULL,
    PRIMARY KEY (store_id, campaign_id, date),
    FOREIGN KEY (store_id, campaign_id) REFERENCES marketing_campaigns(store_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS traffic_daily (
    store_id       TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    date           DATE NOT NULL,
    channel        TEXT NOT NULL,
    sessions       INT NOT NULL,
    product_views  INT NOT NULL,
    add_to_cart    INT NOT NULL,
    checkout       INT NOT NULL,
    PRIMARY KEY (store_id, date, channel)
);

CREATE TABLE IF NOT EXISTS competitors (
    store_id  TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id        TEXT NOT NULL,
    name      TEXT NOT NULL,
    domain    TEXT NOT NULL,
    rating    NUMERIC(3,2) NOT NULL,
    PRIMARY KEY (store_id, id)
);

CREATE TABLE IF NOT EXISTS competitor_prices (
    store_id       TEXT NOT NULL,
    competitor_id  TEXT NOT NULL,
    product_id     TEXT NOT NULL,
    title          TEXT NOT NULL,
    price          NUMERIC(12,2) NOT NULL,
    list_price     NUMERIC(12,2) NOT NULL,
    rating         NUMERIC(3,2) NOT NULL,
    in_stock       BOOLEAN NOT NULL,
    captured_at    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, competitor_id, product_id, captured_at),
    FOREIGN KEY (store_id, competitor_id) REFERENCES competitors(store_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS financial_metrics (
    store_id          TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    date              DATE NOT NULL,
    opex              NUMERIC(14,2) NOT NULL,
    payment_failures  INT NOT NULL,
    failed_amount     NUMERIC(14,2) NOT NULL,
    PRIMARY KEY (store_id, date)
);

CREATE TABLE IF NOT EXISTS news (
    store_id         TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id               TEXT NOT NULL,
    title            TEXT NOT NULL,
    source           TEXT NOT NULL,
    url              TEXT NOT NULL,
    published_at     TIMESTAMPTZ NOT NULL,
    category         TEXT NOT NULL,
    relevance        INT NOT NULL,
    impact           TEXT NOT NULL,
    summary          TEXT NOT NULL,
    why_it_matters   TEXT NOT NULL,
    recommendation   TEXT NOT NULL,
    related_entity   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (store_id, id)
);

-- Agent layer outputs and user state.
CREATE TABLE IF NOT EXISTS agent_insights (
    store_id     TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id           TEXT NOT NULL,
    agent_id     TEXT NOT NULL,
    severity     TEXT NOT NULL,
    title        TEXT NOT NULL,
    payload      JSONB NOT NULL,
    status       TEXT NOT NULL DEFAULT 'new',
    assignee     TEXT NOT NULL DEFAULT '',
    detected_at  TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, id)
);

CREATE TABLE IF NOT EXISTS agent_activity (
    store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id          TEXT NOT NULL,
    agent_id    TEXT NOT NULL,
    kind        TEXT NOT NULL,
    message     TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT '',
    insight_id  TEXT NOT NULL DEFAULT '',
    user_id     TEXT NOT NULL DEFAULT '',
    at          TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, id)
);
CREATE INDEX IF NOT EXISTS agent_activity_at_idx ON agent_activity(store_id, at DESC);

CREATE TABLE IF NOT EXISTS agent_settings (
    store_id   TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    agent_id   TEXT NOT NULL,
    settings   JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, agent_id)
);

CREATE TABLE IF NOT EXISTS notifications (
    store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id          TEXT NOT NULL,
    read        BOOLEAN NOT NULL DEFAULT false,
    dismissed   BOOLEAN NOT NULL DEFAULT false,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, id)
);
