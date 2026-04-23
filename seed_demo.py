# -*- coding: utf-8 -*-
"""
Demo data seeder for InvenVision
Seeds products + 30 days of sales for: ansajkhare@gmail.com
Run: py seed_demo.py
"""
import sys, os, random
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv()

import psycopg2
from datetime import date, timedelta

DATABASE_URL = os.environ.get('DATABASE_URL', '')
if 'sslmode=' not in DATABASE_URL:
    DATABASE_URL += ('&' if '?' in DATABASE_URL else '?') + 'sslmode=require'

EMAIL = 'ansajkhare@gmail.com'

conn = psycopg2.connect(DATABASE_URL, connect_timeout=15)
conn.autocommit = True
cur = conn.cursor()

print("Connected to Supabase!")

# ── 1. Ensure user exists ──────────────────────────────────
cur.execute("""
    INSERT INTO users (email, name, picture)
    VALUES (%s, %s, %s)
    ON CONFLICT (email) DO NOTHING
""", (EMAIL, 'Ansaj Khare', ''))
print("User ready.")

# ── 2. Products ────────────────────────────────────────────
products = [
    # (name, category, unit, buying_price, selling_price, min_stock, current_stock)
    ('Tomato',      'Vegetables', 'kg',     25,  40,  20,  8),
    ('Potato',      'Vegetables', 'kg',     18,  28,  15,  45),
    ('Onion',       'Vegetables', 'kg',     22,  35,  25,  5),
    ('Spinach',     'Vegetables', 'bundle', 15,  25,  10,  3),
    ('Carrot',      'Vegetables', 'kg',     30,  50,  10,  22),
    ('Capsicum',    'Vegetables', 'kg',     60,  90,   8,  12),
    ('Banana',      'Fruits',     'dozen',  30,  50,  15,  4),
    ('Apple',       'Fruits',     'kg',    120, 180,  10,  6),
    ('Mango',       'Fruits',     'kg',     80, 130,  12,  2),
    ('Watermelon',  'Fruits',     'piece', 100, 180,   5,  18),
    ('Grapes',      'Fruits',     'kg',     90, 150,   8,  3),
    ('Papaya',      'Fruits',     'kg',     35,  60,   5,  0),
]

product_ids = {}
for (name, cat, unit, bp, sp, mn, cs) in products:
    cur.execute("""
        INSERT INTO products
            (user_email, name, category, unit, buying_price, selling_price,
             min_stock, current_stock)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user_email, name) DO UPDATE SET
            category      = EXCLUDED.category,
            unit          = EXCLUDED.unit,
            buying_price  = EXCLUDED.buying_price,
            selling_price = EXCLUDED.selling_price,
            min_stock     = EXCLUDED.min_stock,
            current_stock = EXCLUDED.current_stock
        RETURNING id
    """, (EMAIL, name, cat, unit, bp, sp, mn, cs))
    pid = cur.fetchone()[0]
    product_ids[name] = (pid, sp, unit)
    print(f"  Product: {name} (id={pid})")

print(f"Inserted {len(products)} products.")

# ── 3. Sales history — 30 days ────────────────────────────
# Daily qty sold — dramatic varied patterns so AI models show real differences
import math
daily_sales_pattern = {
    # Tomato: spiky high demand with random variation
    'Tomato':    lambda i: max(1, round(6 + 4*math.sin(i/3) + random.randint(-2,3))),
    # Potato: steadily growing trend
    'Potato':    lambda i: max(1, round(4 + i*0.3 + random.randint(-1,2))),
    # Onion: declining trend (oversupplied)
    'Onion':     lambda i: max(0, round(10 - i*0.25 + random.randint(-2,1))),
    # Spinach: strong weekly seasonality (high Mon/Fri, low Wed)
    'Spinach':   lambda i: max(0, round([5,3,2,3,6,7,4][i%7] + random.randint(-1,1))),
    # Carrot: flat stable demand
    'Carrot':    lambda i: max(1, round(3 + random.randint(-1,2))),
    # Capsicum: random volatile
    'Capsicum':  lambda i: max(0, round(2 + random.randint(-1,4))),
    # Banana: growing seasonal trend
    'Banana':    lambda i: max(1, round(3 + i*0.2 + random.randint(-1,2))),
    # Apple: strong weekly pattern
    'Apple':     lambda i: max(0, round([4,2,2,3,5,6,3][i%7] + random.randint(-1,1))),
    # Mango: sharp spike then decline
    'Mango':     lambda i: max(0, round(max(1, 8 - abs(i-10)) + random.randint(-1,2))),
    # Watermelon: weekend spikes
    'Watermelon':lambda i: max(0, round([1,1,1,1,2,4,3][i%7] + random.randint(0,1))),
    # Grapes: declining
    'Grapes':    lambda i: max(0, round(max(0, 6 - i*0.18) + random.randint(-1,1))),
    # Papaya: very volatile
    'Papaya':    lambda i: max(0, round(3 + random.randint(-2,5))),
}


customers = [
    ('Ramesh Sabziwala', '9876543210'),
    ('Sunita Devi',      '9812345678'),
    ('Walk-in Customer', ''),
    ('Sharma Kirana',    '9823456789'),
    ('Daily Fresh',      '9834567890'),
]

inv_count = 0
today = date.today()

for days_ago in range(29, -1, -1):          # 30 days back → today
    sale_date = today - timedelta(days=days_ago)

    # 2 invoices per day
    for inv_idx in range(2):
        cust_name, cust_phone = random.choice(customers)
        inv_no = f"INV-DEMO-{sale_date.strftime('%Y%m%d')}-{inv_idx+1}"

        # pick 3-4 random products for this invoice
        chosen = random.sample(list(daily_sales_pattern.keys()), k=random.randint(3, 4))

        items = []
        subtotal = 0
        for pname in chosen:
            pid, sp, unit = product_ids[pname]
            qty   = daily_sales_pattern[pname](29 - days_ago)   # 0=oldest, 29=today
            total = round(qty * sp, 2)
            subtotal += total
            items.append((pid, pname, qty, sp, total))

        discount = round(random.choice([0, 0, 0, 10, 20, 50]), 2)
        grand    = round(subtotal - discount, 2)
        mode     = random.choice(['Cash', 'Cash', 'UPI', 'Cash'])

        # Insert invoice
        cur.execute("""
            INSERT INTO invoices
                (user_email, invoice_no, customer_name, customer_phone,
                 subtotal, discount, tax_pct, tax_amount, total,
                 payment_mode, status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,0,0,%s,%s,'paid',%s)
            ON CONFLICT (invoice_no) DO NOTHING
            RETURNING id
        """, (EMAIL, inv_no, cust_name, cust_phone,
              subtotal, discount, grand, mode,
              sale_date))
        row = cur.fetchone()
        if not row:
            continue
        inv_id = row[0]

        # Insert invoice items
        for (pid, pname, qty, sp, total) in items:
            cur.execute("""
                INSERT INTO invoice_items
                    (invoice_id, user_email, product_id, product_name,
                     quantity, unit_price, total, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (inv_id, EMAIL, pid, pname, qty, sp, total, sale_date))

        inv_count += 1

print(f"Inserted {inv_count} invoices (60 total across 30 days).")

# ── 4. Customers (Khata) ──────────────────────────────────
khata_customers = [
    ('Ramesh Sabziwala', '9876543210', 'Sector 4, Raipur',   1000, 850,  4200),
    ('Sunita Devi',      '9812345678', 'Market Road, Raipur',  500, 280,  2100),
    ('Sharma Kirana',    '9823456789', 'Gandhi Nagar',         800, 500,  3500),
]
for (name, phone, addr, cl, bal, total) in khata_customers:
    cur.execute("""
        INSERT INTO customers
            (user_email, name, phone, address,
             credit_limit, balance_due, total_purchased)
        VALUES (%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT DO NOTHING
    """, (EMAIL, name, phone, addr, cl, bal, total))
print("Inserted 3 Khata customers.")

conn.close()
print("\nAll demo data inserted successfully!")
print("Open http://127.0.0.1:5000 and login with ansajkhare@gmail.com")
