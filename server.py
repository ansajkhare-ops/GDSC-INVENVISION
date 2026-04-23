# =============================================
#  InvenVision - Flask Backend v4
#  Google OAuth + PostgreSQL (Supabase)
# =============================================

import os
import statistics
import decimal
from functools import wraps
from contextlib import contextmanager

from flask import (Flask, request, jsonify, session,
                   redirect, url_for, render_template)
from flask_cors import CORS
from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv

load_dotenv()

from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-key-change-me')
CORS(app, supports_credentials=True)

# ─── Custom JSON encoder (handles Decimal from PostgreSQL) ───
from flask.json.provider import DefaultJSONProvider
import datetime

class CustomJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        if isinstance(obj, (datetime.date, datetime.datetime)):
            return obj.isoformat()
        return super().default(obj)

app.json_provider_class = CustomJSONProvider
app.json = CustomJSONProvider(app)

# ─── PostgreSQL / Supabase Setup ─────────────
# Railway: set DATABASE_URL in Variables tab
# Format: postgresql://user:password@host:5432/dbname?sslmode=require
_raw_url = os.environ.get('DATABASE_URL', '')

# Ensure sslmode=require is always present (critical for Railway)
if _raw_url and 'sslmode=' not in _raw_url:
    DATABASE_URL = _raw_url + ('&' if '?' in _raw_url else '?') + 'sslmode=require'
else:
    DATABASE_URL = _raw_url

_db_available   = False
_db_init_error  = ''   # stores exact error for debugging


def _make_conn():
    """Open a new PostgreSQL connection with a 10s timeout."""
    import psycopg2
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
    conn.autocommit = True
    return conn


def _check_db():
    """Dynamically test DB connectivity — called per-request."""
    global _db_available, _db_init_error
    if not DATABASE_URL:
        _db_available  = False
        _db_init_error = 'DATABASE_URL environment variable is not set'
        return False
    try:
        conn = _make_conn()
        conn.close()
        _db_available  = True
        _db_init_error = ''
        return True
    except Exception as e:
        _db_available  = False
        _db_init_error = str(e)
        return False


def init_db():
    """Connect to PostgreSQL and create tables. Retries 3 times on failure."""
    global _db_available, _db_init_error
    if not DATABASE_URL:
        print('[DB] DATABASE_URL not set. Running in localStorage fallback mode.')
        _db_init_error = 'DATABASE_URL not set'
        return
    for attempt in range(1, 4):
        try:
            import psycopg2
            conn = _make_conn()
            cur  = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id         SERIAL PRIMARY KEY,
                    email      VARCHAR(255) NOT NULL UNIQUE,
                    name       VARCHAR(255),
                    picture    VARCHAR(512),
                    created_at TIMESTAMP DEFAULT NOW(),
                    last_login TIMESTAMP DEFAULT NOW()
                )""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS inventory (
                    id            SERIAL PRIMARY KEY,
                    user_email    VARCHAR(255) NOT NULL,
                    item_name     VARCHAR(255) NOT NULL,
                    current_stock FLOAT DEFAULT 0,
                    reorder_point FLOAT DEFAULT 0,
                    next_week     FLOAT DEFAULT 0,
                    next_month    FLOAT DEFAULT 0,
                    days_left     INT DEFAULT 0,
                    status        VARCHAR(20) DEFAULT 'ok',
                    updated_date  VARCHAR(50),
                    expiry_date   VARCHAR(50),
                    updated_at    TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_user_item UNIQUE (user_email, item_name)
                )""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS prediction_history (
                    id            SERIAL PRIMARY KEY,
                    user_email    VARCHAR(255) NOT NULL,
                    item_name     VARCHAR(255) NOT NULL,
                    model         VARCHAR(50),
                    auto_selected VARCHAR(50),
                    next_day      FLOAT,
                    next_week     FLOAT,
                    next_month    FLOAT,
                    status        VARCHAR(20),
                    sales_count   INT,
                    created_at    TIMESTAMP DEFAULT NOW()
                )""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS products (
                    id            SERIAL PRIMARY KEY,
                    user_email    VARCHAR(255) NOT NULL,
                    name          VARCHAR(255) NOT NULL,
                    category      VARCHAR(100) DEFAULT 'General',
                    unit          VARCHAR(50)  DEFAULT 'pcs',
                    description   TEXT,
                    buying_price  DECIMAL(10,2) DEFAULT 0,
                    selling_price DECIMAL(10,2) DEFAULT 0,
                    min_stock     DECIMAL(10,2) DEFAULT 0,
                    current_stock DECIMAL(10,2) DEFAULT 0,
                    created_at    TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_product UNIQUE (user_email, name)
                )""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS stock_in (
                    id           SERIAL PRIMARY KEY,
                    user_email   VARCHAR(255) NOT NULL,
                    product_id   INT REFERENCES products(id) ON DELETE CASCADE,
                    product_name VARCHAR(255),
                    quantity     DECIMAL(10,2) NOT NULL,
                    buying_price DECIMAL(10,2) DEFAULT 0,
                    supplier     VARCHAR(255),
                    batch_no     VARCHAR(100),
                    expiry_date  DATE,
                    note         TEXT,
                    created_at   TIMESTAMP DEFAULT NOW()
                )""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS invoices (
                    id             SERIAL PRIMARY KEY,
                    user_email     VARCHAR(255) NOT NULL,
                    invoice_no     VARCHAR(50) UNIQUE,
                    customer_name  VARCHAR(255) DEFAULT 'Walk-in',
                    customer_phone VARCHAR(20),
                    subtotal       DECIMAL(10,2) DEFAULT 0,
                    discount       DECIMAL(10,2) DEFAULT 0,
                    tax_pct        DECIMAL(5,2)  DEFAULT 0,
                    tax_amount     DECIMAL(10,2) DEFAULT 0,
                    total          DECIMAL(10,2) DEFAULT 0,
                    payment_mode   VARCHAR(50)   DEFAULT 'Cash',
                    status         VARCHAR(20)   DEFAULT 'paid',
                    created_at     TIMESTAMP DEFAULT NOW()
                )""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS invoice_items (
                    id           SERIAL PRIMARY KEY,
                    invoice_id   INT REFERENCES invoices(id) ON DELETE CASCADE,
                    user_email   VARCHAR(255) NOT NULL,
                    product_id   INT REFERENCES products(id),
                    product_name VARCHAR(255),
                    quantity     DECIMAL(10,2),
                    unit_price   DECIMAL(10,2),
                    total        DECIMAL(10,2),
                    created_at   TIMESTAMP DEFAULT NOW()
                )""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS customers (
                    id              SERIAL PRIMARY KEY,
                    user_email      VARCHAR(255) NOT NULL,
                    name            VARCHAR(255) NOT NULL,
                    phone           VARCHAR(20),
                    address         TEXT,
                    credit_limit    DECIMAL(10,2) DEFAULT 0,
                    balance_due     DECIMAL(10,2) DEFAULT 0,
                    total_purchased DECIMAL(10,2) DEFAULT 0,
                    created_at      TIMESTAMP DEFAULT NOW()
                )""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS customer_payments (
                    id           SERIAL PRIMARY KEY,
                    user_email   VARCHAR(255) NOT NULL,
                    customer_id  INT REFERENCES customers(id) ON DELETE CASCADE,
                    amount       DECIMAL(10,2) NOT NULL,
                    note         VARCHAR(255),
                    payment_mode VARCHAR(50) DEFAULT 'Cash',
                    type         VARCHAR(20) DEFAULT 'payment',
                    created_at   TIMESTAMP DEFAULT NOW()
                )""")
            cur.close()
            conn.close()
            _db_available  = True
            _db_init_error = ''
            print(f'[DB] PostgreSQL (Supabase) connected and tables ready. (attempt {attempt})')
            return
        except Exception as e:
            _db_init_error = str(e)
            print(f'[DB] Attempt {attempt}/3 failed: {e}')
            import time; time.sleep(2)
    _db_available = False
    print(f'[DB] All connection attempts failed. Last error: {_db_init_error}')
    print('[DB] Running in localStorage fallback mode.')


@contextmanager
def get_db():
    """Yield a PostgreSQL connection. Raises clear error if DB unavailable."""
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL is not set. Add it in Railway Variables.')
    conn = _make_conn()
    try:
        yield conn
    finally:
        conn.close()


def dict_cursor(conn):
    """Return a cursor that yields dict-like rows."""
    import psycopg2.extras
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)



# ─── Google OAuth ─────────────────────────────
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=os.environ.get('GOOGLE_CLIENT_ID'),
    client_secret=os.environ.get('GOOGLE_CLIENT_SECRET'),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            if request.is_json:
                return jsonify({'error': 'Authentication required'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


# ─── Page Routes ──────────────────────────────

@app.route('/')
@login_required
def index():
    return redirect(url_for('advisor_page'))


@app.route('/login')
def login():
    if 'user' in session:
        return redirect(url_for('index'))
    return render_template('login.html')


@app.before_request
def refresh_db_if_needed():
    """If DB failed at startup, retry on each request until it connects."""
    global _db_available
    if not _db_available:
        _check_db()


@app.route('/auth/google')
def auth_google():
    redirect_uri = url_for('auth_google_callback', _external=True)
    return google.authorize_redirect(redirect_uri)


@app.route('/auth/google/callback')
def auth_google_callback():
    try:
        token    = google.authorize_access_token()
        userinfo = token.get('userinfo')
        if userinfo:
            session.permanent = True
            user = {
                'name':       userinfo.get('name', 'User'),
                'email':      userinfo.get('email', ''),
                'picture':    userinfo.get('picture', ''),
                'given_name': userinfo.get('given_name', 'User'),
            }
            session['user'] = user
            # Upsert user into DB
            if _db_available:
                try:
                    with get_db() as conn:
                        cur = conn.cursor()
                        cur.execute("""
                            INSERT INTO users (email, name, picture)
                            VALUES (%s, %s, %s)
                            ON CONFLICT (email) DO UPDATE SET
                                name=EXCLUDED.name,
                                picture=EXCLUDED.picture,
                                last_login=NOW()
                        """, (user['email'], user['name'], user['picture']))
                except Exception as e:
                    print(f'[DB] User upsert error: {e}')
        return redirect(url_for('index'))
    except Exception as e:
        print(f'[Auth] Callback error: {e}')
        return redirect(url_for('login') + '?error=auth_failed')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# ─── Forecasting Algorithms ───────────────────

def simple_moving_average(data, window=7):
    """SMA: uses rolling window. Trend from last vs earlier period drives projection."""
    w = min(window, len(data))
    base_avg = sum(data[-w:]) / w
    # Detect recent momentum: compare last-half vs first-half of the window
    half = max(1, w // 2)
    recent_avg = sum(data[-half:]) / half
    older_avg  = sum(data[-w:-half]) / max(half, 1) if w > half else base_avg
    momentum   = (recent_avg - older_avg) / half
    result = []
    for i in range(14):
        damping = 0.88 ** i          # momentum fades over time
        val = max(0.0, base_avg + momentum * (i + 1) * damping)
        result.append(round(val, 2))
    return result


def exponential_moving_average(data, alpha=0.3):
    """EMA: uses smoothing + recent momentum (dampened) for 14-day projection."""
    ema = data[0]
    for v in data[1:]:
        ema = alpha * v + (1 - alpha) * ema
    # Calculate short-term momentum from last 5 values
    n = min(5, len(data))
    recent = data[-n:]
    if n >= 2:
        momentum = (recent[-1] - recent[0]) / (n - 1)
    else:
        momentum = 0.0
    result = []
    for i in range(14):
        damping = 0.80 ** i          # momentum decays further out
        val = max(0.0, ema + momentum * (i + 1) * damping)
        result.append(round(val, 2))
    return result


def holts_double_exponential(data, alpha=0.4, beta=0.3):
    """Holt's: tracks level + trend — best for growing/declining sales."""
    if len(data) < 2:
        return exponential_moving_average(data)
    S, T = data[0], data[1] - data[0]
    for v in data[1:]:
        Sp, Tp = S, T
        S = alpha * v + (1 - alpha) * (Sp + Tp)
        T = beta * (S - Sp) + (1 - beta) * Tp
    return [max(0.0, round(S + h * T, 2)) for h in range(1, 15)]


def linear_regression_forecast(data):
    """Linear Regression: fits a straight-line trend through all data."""
    n = len(data); xm = (n - 1) / 2; ym = sum(data) / n
    num = sum((i - xm) * (data[i] - ym) for i in range(n))
    den = sum((i - xm) ** 2 for i in range(n))
    sl = num / den if den else 0
    ic = ym - sl * xm
    return [max(0.0, round(ic + sl * (n - 1 + h), 2)) for h in range(1, 15)]


def weighted_moving_average(data, window=7):
    """WMA: recent days get higher weights + carries momentum forward."""
    w = min(window, len(data))
    weights   = list(range(1, w + 1))
    total_w   = sum(weights)
    base_wma  = sum(data[-w:][i] * weights[i] for i in range(w)) / total_w
    # Momentum: weighted recent vs older
    half = max(1, w // 2)
    r_w  = list(range(1, half + 1))
    o_w  = list(range(1, w - half + 1))
    recent_wma = sum(data[-half:][i] * r_w[i] for i in range(half)) / sum(r_w)
    older_wma  = (sum(data[-w:-half][i] * o_w[i] for i in range(w - half)) / sum(o_w)
                  if w > half else base_wma)
    momentum = (recent_wma - older_wma) / max(half, 1)
    result = []
    for i in range(14):
        damping = 0.85 ** i
        val = max(0.0, base_wma + momentum * (i + 1) * damping)
        result.append(round(val, 2))
    return result


def seasonal_naive(data, period=7):
    """Seasonal Naive: repeats the same weekday sales from last cycle."""
    if len(data) < period:
        return exponential_moving_average(data)
    return [max(0.0, round(data[-(period - (i % period))], 2)) for i in range(14)]



MODELS = {
    'sma':    simple_moving_average,
    'ema':    exponential_moving_average,
    'wma':    weighted_moving_average,
    'holt':   holts_double_exponential,
    'linear': linear_regression_forecast,
    'naive':  seasonal_naive,
}
MODEL_NAMES = {
    'sma':    'Simple Moving Average',
    'ema':    'Exponential Moving Average',
    'wma':    'Weighted Moving Average',
    'holt':   "Holt's Double Exponential",
    'linear': 'Linear Regression',
    'naive':  'Seasonal Naive',
}

def auto_select_model(data):
    if len(data) < 6: return 'ema', exponential_moving_average
    sp = max(3, int(len(data) * 0.8))
    train, test = data[:sp], data[sp:]; nt = len(test)
    best, bm = float('inf'), 'ema'
    for name, fn in MODELS.items():
        mae = sum(abs(p-a) for p,a in zip(fn(train)[:nt], test)) / nt
        if mae < best: best, bm = mae, name
    return bm, MODELS[bm]

def detect_seasonality(data):
    if len(data) < 7: return None
    oa = statistics.mean(data)
    if oa == 0: return None
    bk = {}
    for i, v in enumerate(data): bk.setdefault(i%7, []).append(v)
    dm = {d: statistics.mean(v) for d,v in bk.items()}
    names = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    mx, mn = max(dm, key=dm.get), min(dm, key=dm.get)
    mp = round((dm[mx]-oa)/oa*100, 1); lp = round((oa-dm[mn])/oa*100, 1)
    if mp > 12: return f"Demand peaks on {names[mx]}s (+{mp}% above average)"
    if lp > 12: return f"Demand dips on {names[mn]}s (-{lp}% below average)"
    return "No strong weekly pattern detected"

def compute_volatility(data):
    if len(data) < 2: return 0.0
    m = statistics.mean(data)
    return round(statistics.stdev(data)/m*100, 1) if m else 0.0

def days_of_stock(stock, avg):
    return 999 if avg <= 0 else max(0, int(stock/avg))

def reorder_decision(stock, rp, lt, avg):
    safety = avg * lt
    if stock <= 0: return 'danger', 'Out of Stock! Reorder immediately.'
    if rp > 0 and stock <= rp:
        return 'danger', f'Reorder NOW! Stock ({int(stock)}) hit reorder point ({int(rp)}).'
    if rp > 0 and stock <= rp * 1.5:
        return 'warning', f'Stock getting low. Reorder point: {int(rp)} units.'
    if safety > 0 and stock <= safety:
        return 'warning', f'May run out during lead time ({lt}d). Reorder recommended.'
    return 'ok', 'Stock is sufficient. No reorder needed.'


# ─── API: Predict ─────────────────────────────

@app.route('/api/predict', methods=['POST'])
@login_required
def predict():
    body = request.get_json(silent=True)
    if not body: return jsonify({'error': 'No JSON body'}), 400

    sales_data    = body.get('sales_data', [])
    current_stock = float(body.get('current_stock', 0))
    reorder_point = float(body.get('reorder_point', 0))
    lead_time     = int(body.get('lead_time', 7))
    model_key     = body.get('model', 'ema')
    item_name     = body.get('item_name', 'Item')

    if not sales_data or len(sales_data) < 2:
        return jsonify({'error': 'Provide at least 2 days of sales data'}), 422

    sales_data = [max(0.0, float(v)) for v in sales_data]

    auto_selected = None
    if model_key == 'auto':
        auto_selected, forecast_fn = auto_select_model(sales_data)
    else:
        forecast_fn = MODELS.get(model_key, exponential_moving_average)

    forecast_14  = forecast_fn(sales_data)
    std          = statistics.stdev(sales_data) if len(sales_data) > 1 else 0
    fu           = [round(max(0.0, v+1.5*std), 2) for v in forecast_14]
    fl           = [round(max(0.0, v-1.5*std), 2) for v in forecast_14]
    next_day     = forecast_14[0]
    next_week    = sum(forecast_14[:7])
    next_month   = next_week + (next_week/7*23)
    avg_daily    = statistics.mean(sales_data)
    peak_day     = int(max(sales_data))
    volatility   = compute_volatility(sales_data)
    stock_days   = days_of_stock(current_stock, avg_daily)
    status, msg  = reorder_decision(current_stock, reorder_point, lead_time, avg_daily)
    seasonality  = detect_seasonality(sales_data)

    # Save history to MySQL (if available)
    user_email = session['user']['email']
    if _db_available:
        try:
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO prediction_history
                      (user_email,item_name,model,auto_selected,
                       next_day,next_week,next_month,status,sales_count)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (user_email, item_name,
                      model_key, auto_selected,
                      round(next_day,2), round(next_week,2), round(next_month,2),
                      status, len(sales_data)))
        except Exception as e:
            print(f'[DB] History insert error: {e}')

    return jsonify({
        'item_name':       item_name, 'model': model_key,
        'auto_selected':   auto_selected,
        'auto_model_name': MODEL_NAMES.get(auto_selected,'') if auto_selected else '',
        'next_day':        round(next_day,2), 'next_week': round(next_week,2),
        'next_month':      round(next_month,2),
        'forecast_series': [round(v,2) for v in forecast_14],
        'forecast_upper':  fu, 'forecast_lower': fl,
        'avg_daily':       round(avg_daily,2), 'peak_day': peak_day,
        'volatility':      volatility, 'stock_days_left': stock_days,
        'reorder_status':  status, 'reorder_message': msg,
        'seasonality':     seasonality, 'std': round(std,2),
    })


# ─── API: Inventory (MySQL) ───────────────────

@app.route('/api/inventory', methods=['GET'])
@login_required
def get_inventory():
    email = session['user']['email']
    if not _db_available:
        return jsonify({'items': [], 'db_available': False})
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            cur.execute("""
                SELECT id, item_name, current_stock, reorder_point,
                       next_week, next_month, days_left, status, updated_date,
                       expiry_date,
                       CASE WHEN expiry_date IS NOT NULL
                            THEN (expiry_date - CURRENT_DATE)::int
                            ELSE NULL END as days_to_expiry
                FROM inventory WHERE user_email=%s
                ORDER BY updated_at DESC
            """, (email,))
            items = list(cur.fetchall())
        return jsonify({'items': items, 'db_available': True})
    except Exception as e:
        return jsonify({'error': str(e), 'db_available': False}), 500


@app.route('/api/inventory', methods=['POST'])
@login_required
def save_inventory():
    email = session['user']['email']
    body  = request.get_json(silent=True) or {}
    if not _db_available:
        return jsonify({'error': 'Database not available'}), 503
    try:
        with get_db() as conn:
            cur = conn.cursor()
            expiry_raw = body.get('expiry_date') or None
            cur.execute("""
                INSERT INTO inventory
                  (user_email,item_name,current_stock,reorder_point,
                   next_week,next_month,days_left,status,updated_date,expiry_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (user_email, item_name) DO UPDATE SET
                  current_stock = EXCLUDED.current_stock,
                  reorder_point = EXCLUDED.reorder_point,
                  next_week     = EXCLUDED.next_week,
                  next_month    = EXCLUDED.next_month,
                  days_left     = EXCLUDED.days_left,
                  status        = EXCLUDED.status,
                  updated_date  = EXCLUDED.updated_date,
                  expiry_date   = EXCLUDED.expiry_date,
                  updated_at    = NOW()
            """, (
                email,
                body.get('item_name',''),
                body.get('current_stock', 0),
                body.get('reorder_point', 0),
                body.get('next_week', 0),
                body.get('next_month', 0),
                body.get('days_left', 0),
                body.get('status', 'ok'),
                body.get('updated_date', ''),
                expiry_raw,
            ))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/inventory/<int:item_id>', methods=['DELETE'])
@login_required
def delete_inventory(item_id):
    email = session['user']['email']
    if not _db_available:
        return jsonify({'error': 'Database not available'}), 503
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM inventory WHERE id=%s AND user_email=%s",
                        (item_id, email))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── API: History (MySQL) ─────────────────────

@app.route('/api/history', methods=['GET'])
@login_required
def get_history():
    email = session['user']['email']
    if not _db_available:
        return jsonify({'items': [], 'db_available': False})
    try:
        with get_db() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute("""
                SELECT id, item_name, model, auto_selected,
                       next_day, next_week, next_month, status,
                       sales_count,
                       DATE_FORMAT(created_at, '%%d %%b %%Y') AS date
                FROM prediction_history
                WHERE user_email=%s
                ORDER BY created_at DESC
                LIMIT 50
            """, (email,))
            items = cur.fetchall()
        return jsonify({'items': items, 'db_available': True})
    except Exception as e:
        return jsonify({'error': str(e), 'db_available': False}), 500


# ─── Health ───────────────────────────────────

@app.route('/api/suggestions', methods=['GET'])
@login_required
def get_suggestions():
    from datetime import date
    email = session['user']['email']
    suggestions = []
    stats = {'total': 0, 'alerts': 0, 'healthy': 0, 'expiring': 0}
    if not _db_available:
        return jsonify({'suggestions': [], 'stats': stats, 'db_available': False})
    try:
        with get_db() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute("""
                SELECT *, DATEDIFF(expiry_date, CURDATE()) as days_to_expiry
                FROM inventory WHERE user_email=%s ORDER BY updated_at DESC
            """, (email,))
            items = cur.fetchall()
        stats['total'] = len(items)
        for item in items:
            name = item['item_name']
            status = item.get('status', 'ok')
            days_left = item.get('days_left', 999) or 999
            current_stock = item.get('current_stock', 0) or 0
            next_month = item.get('next_month', 0) or 0
            dte = item.get('days_to_expiry')

            # Expiry alerts
            if dte is not None:
                if dte < 0:
                    suggestions.append({'type':'danger','icon':'❌','text':f"{name} has EXPIRED — remove from stock immediately!",'priority':1})
                    stats['alerts'] += 1
                elif dte <= 3:
                    suggestions.append({'type':'danger','icon':'⏰','text':f"{name} expires in {dte} day{'s' if dte!=1 else ''} — urgent action needed!",'priority':1})
                    stats['alerts'] += 1; stats['expiring'] += 1
                elif dte <= 7:
                    suggestions.append({'type':'warning','icon':'⏰','text':f"{name} expires in {dte} days — consider a discount to sell faster",'priority':2})
                    stats['expiring'] += 1

            # Stock alerts
            if status == 'danger':
                suggestions.append({'type':'danger','icon':'🚨','text':f"Reorder {name} NOW — only {days_left} day{'s' if days_left!=1 else ''} of stock remaining",'priority':1})
                stats['alerts'] += 1
            elif status == 'warning':
                suggestions.append({'type':'warning','icon':'⚠️','text':f"Stock running low for {name} — plan a reorder this week",'priority':2})
                stats['alerts'] += 1

            # Dead stock detection
            if current_stock > 0 and next_month > 0:
                months = current_stock / (next_month / 30)
                if months > 3:
                    suggestions.append({'type':'info','icon':'📦','text':f"{name} is overstocked — {round(months,1)} months of supply on hand. Avoid restocking.",'priority':3})

            if status == 'ok' and (dte is None or dte > 7):
                stats['healthy'] += 1

        suggestions.sort(key=lambda x: x.get('priority', 99))
        if not suggestions and stats['total'] > 0:
            suggestions.append({'type':'ok','icon':'✅','text':'All inventory is healthy! No urgent actions needed today.','priority':99})
        elif stats['total'] == 0:
            suggestions.append({'type':'info','icon':'💡','text':'Run a forecast and save items to Inventory to see AI suggestions here!','priority':99})
        return jsonify({'suggestions': suggestions, 'stats': stats, 'db_available': True})
    except Exception as e:
        return jsonify({'error': str(e), 'suggestions': [], 'stats': stats}), 500


@app.route('/api/health', methods=['GET'])
def health():
    live = _check_db()
    return jsonify({
        'status':        'ok' if live else 'db_error',
        'db_available':  live,
        'db_error':      _db_init_error if not live else None,
        'db_url_set':    bool(DATABASE_URL),
        'db_host':       DATABASE_URL.split('@')[-1].split('/')[0] if DATABASE_URL else None,
    })


@app.route('/api/analytics-charts', methods=['GET'])
@login_required
def analytics_charts():
    """Returns chart data for analytics page — sales trends, top products, categories."""
    from datetime import date, timedelta
    email = session['user']['email']
    if not _db_available:
        return jsonify({'error': 'DB not available', 'detail': _db_init_error}), 503
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)

            # 1. Daily revenue last 30 days
            since30 = date.today() - timedelta(days=29)
            cur.execute("""
                SELECT DATE(created_at) as d, SUM(total) as revenue, COUNT(*) as invoices
                FROM invoices WHERE user_email=%s AND created_at >= %s
                GROUP BY DATE(created_at) ORDER BY d ASC
            """, (email, since30))
            daily_rows = cur.fetchall()
            date_rev_map = {str(r['d']): float(r['revenue'] or 0) for r in daily_rows}
            date_inv_map = {str(r['d']): int(r['invoices'] or 0) for r in daily_rows}
            daily_labels  = [(since30 + timedelta(days=i)).strftime('%d %b') for i in range(30)]
            daily_revenue = [(since30 + timedelta(days=i)) for i in range(30)]
            daily_revenue_vals = [date_rev_map.get(d.strftime('%Y-%m-%d'), 0) for d in daily_revenue]
            daily_invoice_vals = [date_inv_map.get(d.strftime('%Y-%m-%d'), 0) for d in daily_revenue]

            # 2. Weekly revenue last 12 weeks
            weekly_labels, weekly_vals = [], []
            for w in range(11, -1, -1):
                wstart = date.today() - timedelta(weeks=w+1)
                wend   = date.today() - timedelta(weeks=w)
                cur.execute("""
                    SELECT COALESCE(SUM(total),0) as rev FROM invoices
                    WHERE user_email=%s AND created_at >= %s AND created_at < %s
                """, (email, wstart, wend))
                rev = float(cur.fetchone()['rev'] or 0)
                weekly_labels.append(wstart.strftime('%d %b'))
                weekly_vals.append(rev)

            # 3. Top 8 products by units sold
            cur.execute("""
                SELECT product_name, SUM(quantity) as units, SUM(total) as revenue
                FROM invoice_items WHERE user_email=%s
                GROUP BY product_name ORDER BY units DESC LIMIT 8
            """, (email,))
            top = cur.fetchall()
            top_labels   = [r['product_name'] for r in top]
            top_units    = [float(r['units'] or 0) for r in top]
            top_revenue  = [float(r['revenue'] or 0) for r in top]

            # 4. Category breakdown
            cur.execute("""
                SELECT p.category, SUM(ii.total) as revenue
                FROM invoice_items ii
                JOIN products p ON ii.product_id = p.id
                WHERE ii.user_email=%s
                GROUP BY p.category ORDER BY revenue DESC LIMIT 8
            """, (email,))
            cat_rows = cur.fetchall()
            cat_labels = [r['category'] or 'General' for r in cat_rows]
            cat_vals   = [float(r['revenue'] or 0) for r in cat_rows]

            # 5. Summary stats
            cur.execute("SELECT COUNT(*) as c FROM products WHERE user_email=%s", (email,))
            total_products = cur.fetchone()['c']
            cur.execute("SELECT COALESCE(SUM(total),0) as r, COUNT(*) as c FROM invoices WHERE user_email=%s", (email,))
            row = cur.fetchone()
            total_revenue  = float(row['r'] or 0)
            total_invoices = int(row['c'] or 0)
            cur.execute("""
                SELECT COUNT(*) as c FROM products
                WHERE user_email=%s AND current_stock <= min_stock AND min_stock > 0
            """, (email,))
            low_stock = cur.fetchone()['c']
            # Today's stats
            cur.execute("""
                SELECT COALESCE(SUM(total),0) as r, COUNT(*) as c FROM invoices
                WHERE user_email=%s AND DATE(created_at) = %s
            """, (email, date.today()))
            today = cur.fetchone()
            today_revenue  = float(today['r'] or 0)
            today_invoices = int(today['c'] or 0)

        return jsonify({
            'stats': {
                'total_products': total_products, 'total_revenue': total_revenue,
                'total_invoices': total_invoices, 'low_stock': low_stock,
                'today_revenue': today_revenue, 'today_invoices': today_invoices,
            },
            'daily':  {'labels': daily_labels, 'revenue': daily_revenue_vals, 'invoices': daily_invoice_vals},
            'weekly': {'labels': weekly_labels, 'revenue': weekly_vals},
            'top_products': {'labels': top_labels, 'units': top_units, 'revenue': top_revenue},
            'categories':   {'labels': cat_labels, 'revenue': cat_vals},
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/reorder-advisor', methods=['GET'])
@login_required
def reorder_advisor():
    """Automatically calculate reorder recommendations from actual sales data."""
    from datetime import date, timedelta
    email = session['user']['email']
    if not _db_available:
        return jsonify({'items': []})
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            # Get all products
            cur.execute("SELECT * FROM products WHERE user_email=%s", (email,))
            products = list(cur.fetchall())
            results = []
            for p in products:
                pid          = p['id']
                current_stock = float(p['current_stock'] or 0)
                min_stock     = float(p['min_stock'] or 0)
                # Get total units sold in last 30 days
                cur.execute("""
                    SELECT COALESCE(SUM(ii.quantity), 0) as total_sold,
                           COUNT(DISTINCT DATE(i.created_at)) as days_with_sales
                    FROM invoice_items ii
                    JOIN invoices i ON ii.invoice_id = i.id
                    WHERE ii.user_email=%s AND ii.product_id=%s
                    AND i.created_at >= %s
                """, (email, pid, date.today() - timedelta(days=30)))
                row = cur.fetchone()
                total_sold     = float(row['total_sold'] or 0)
                days_with_sales = int(row['days_with_sales'] or 0)
                # Average daily sales (only count days that had sales, min 1)
                avg_daily = round(total_sold / max(days_with_sales, 1), 2) if total_sold > 0 else 0
                # Days of stock remaining
                if avg_daily > 0:
                    days_left = round(current_stock / avg_daily)
                else:
                    days_left = 999  # Unknown, no sales yet
                # Suggested order quantity = 30 days supply + 20% buffer
                suggested_qty = round(avg_daily * 30 * 1.2) if avg_daily > 0 else 0
                # Urgency level
                if days_left <= 3:
                    urgency = 'critical'
                elif days_left <= 7:
                    urgency = 'warning'
                elif current_stock <= min_stock:
                    urgency = 'warning'
                elif days_left <= 14:
                    urgency = 'soon'
                else:
                    urgency = 'ok'
                results.append({
                    'id':            pid,
                    'name':          p['name'],
                    'category':      p['category'],
                    'unit':          p['unit'],
                    'current_stock': current_stock,
                    'min_stock':     min_stock,
                    'avg_daily':     avg_daily,
                    'days_left':     days_left if days_left < 999 else None,
                    'suggested_qty': suggested_qty,
                    'urgency':       urgency,
                    'has_sales_data': total_sold > 0,
                })
            # Sort: critical first, then warning, then soon, then ok
            order = {'critical': 0, 'warning': 1, 'soon': 2, 'ok': 3}
            results.sort(key=lambda x: order.get(x['urgency'], 9))
        return jsonify({'items': results})
    except Exception as e:
        return jsonify({'error': str(e)}), 500



@app.route('/api/product-analysis/<int:pid>', methods=['GET'])
@login_required
def product_analysis(pid):
    """Fully automatic analysis — reads sales from DB, returns plain English notifications."""
    from datetime import date, timedelta
    email      = session['user']['email']
    days       = max(1, int(request.args.get('days', 30)))
    model_key  = request.args.get('model', 'ema')
    if not _db_available:
        return jsonify({'error': 'DB not available'}), 503
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            # Get product info
            cur.execute("SELECT * FROM products WHERE id=%s AND user_email=%s", (pid, email))
            p = cur.fetchone()
            if not p:
                return jsonify({'error': 'Product not found'}), 404

            p = dict(p)  # ensure plain dict
            current_stock = float(p['current_stock'] or 0)
            min_stock     = float(p['min_stock'] or 0)
            unit          = p['unit']
            name          = p['name']

            # Get daily sales breakdown for the selected period
            since = date.today() - timedelta(days=days)
            cur.execute("""
                SELECT DATE(i.created_at) as sale_date,
                       SUM(ii.quantity) as daily_qty,
                       SUM(ii.total)    as daily_revenue
                FROM invoice_items ii
                JOIN invoices i ON ii.invoice_id = i.id
                WHERE ii.user_email=%s AND ii.product_id=%s
                AND i.created_at >= %s
                GROUP BY DATE(i.created_at)
                ORDER BY sale_date ASC
            """, (email, pid, since))
            daily_rows = list(cur.fetchall())

            # Build date-filled array (0 for days with no sales)
            date_map = {}
            for row in daily_rows:
                d_str = str(row['sale_date'])
                date_map[d_str] = float(row['daily_qty'] or 0)

            sales_series = []
            for i in range(days):
                d = (since + timedelta(days=i+1)).strftime('%Y-%m-%d')
                sales_series.append(date_map.get(d, 0))

            labels = [(since + timedelta(days=i+1)).strftime('%d %b') for i in range(days)]

            total_sold     = sum(sales_series)
            days_with_data = sum(1 for x in sales_series if x > 0)
            avg_daily      = round(total_sold / max(days_with_data, 1), 1) if total_sold > 0 else 0

            # Days of stock remaining
            days_left     = round(current_stock / avg_daily) if avg_daily > 0 else None
            suggested_qty = round(avg_daily * 30 * 1.2) if avg_daily > 0 else 0

            # ── Plain English Notifications ───────────────
            notifications = []

            if current_stock <= 0:
                notifications.append({'level': 'critical', 'icon': '🚨',
                    'text': f'Your stock of {name} is completely EMPTY. Stop selling and restock immediately.'})
            elif days_left is not None and days_left <= 2:
                notifications.append({'level': 'critical', 'icon': '🚨',
                    'text': f'Your stock of {name} will last only {days_left} more day{"" if days_left==1 else "s"}. Order NOW.'})
            elif days_left is not None and days_left <= 7:
                notifications.append({'level': 'warning', 'icon': '⚠️',
                    'text': f'Your stock of {name} has only {days_left} days left. Place an order this week.'})
            elif days_left is not None and days_left <= 14:
                notifications.append({'level': 'info', 'icon': '📅',
                    'text': f'Your stock of {name} will last about {days_left} days. Time to plan your next order.'})
            elif days_left is not None:
                notifications.append({'level': 'ok', 'icon': '✅',
                    'text': f'Your stock of {name} is healthy — about {days_left} days remaining. No action needed.'})
            else:
                notifications.append({'level': 'info', 'icon': '📊',
                    'text': f'No sales recorded for {name} in the last {days} days. Start selling to get predictions.'})

            if avg_daily > 0:
                notifications.append({'level': 'info', 'icon': '📈',
                    'text': f'You sell an average of {avg_daily} {unit} of {name} per selling day.'})

            if suggested_qty > 0:
                notifications.append({'level': 'info', 'icon': '🛒',
                    'text': f'Recommended order quantity: {suggested_qty} {unit} — enough for the next 30 days.'})

            if current_stock <= min_stock and min_stock > 0:
                notifications.append({'level': 'warning', 'icon': '⚠️',
                    'text': f'Stock ({current_stock} {unit}) is below your minimum level ({min_stock} {unit}). Restock needed.'})

            # ── AI Forecast using selected model ──────────
            forecast_series = []
            auto_selected   = None
            model_name      = MODEL_NAMES.get(model_key, 'EMA')
            non_zero        = [v for v in sales_series if v > 0]

            if len(non_zero) >= 2:
                data_for_model = non_zero
                if model_key == 'auto':
                    auto_selected, forecast_fn = auto_select_model(data_for_model)
                    model_name = MODEL_NAMES.get(auto_selected, '')
                else:
                    forecast_fn = MODELS.get(model_key, exponential_moving_average)
                raw = forecast_fn(data_for_model)
                forecast_series = [round(v, 1) for v in raw[:14]]

        return jsonify({
            'product':         {'id': pid, 'name': name, 'unit': unit,
                                'category': p['category'],
                                'current_stock': current_stock, 'min_stock': min_stock},
            'period_days':     days,
            'total_sold':      round(total_sold, 2),
            'avg_daily':       avg_daily,
            'days_left':       days_left,
            'suggested_qty':   suggested_qty,
            'sales_series':    sales_series,
            'labels':          labels,
            'forecast_series': forecast_series,
            'model_used':      auto_selected or model_key,
            'model_name':      model_name,
            'notifications':   notifications,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── New Page Routes ─────────────────────────


@app.route('/advisor')
@login_required
def advisor_page():
    return render_template('advisor.html', user=session['user'], active='advisor')


@app.route('/stock')
@login_required
def stock_page():
    return render_template('stock.html', user=session['user'], active='stock')

@app.route('/sales')
@login_required
def sales_page():
    return render_template('sales.html', user=session['user'], active='sales')

@app.route('/analytics')
@login_required
def analytics_page():
    return render_template('analytics.html', user=session['user'], active='analytics')

@app.route('/forecast')
@login_required
def forecast_page():
    return render_template('forecast.html', user=session['user'], active='forecast')


# ─── Products API ─────────────────────────────

@app.route('/api/products', methods=['GET'])
@login_required
def get_products():
    email  = session['user']['email']
    search = request.args.get('search', '')
    if not _db_available:
        return jsonify({'products': []})
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            if search:
                cur.execute("""
                    SELECT * FROM products WHERE user_email=%s
                    AND (name ILIKE %s OR category ILIKE %s OR description ILIKE %s)
                    ORDER BY name
                """, (email, f'%{search}%', f'%{search}%', f'%{search}%'))
            else:
                cur.execute("SELECT * FROM products WHERE user_email=%s ORDER BY name", (email,))
            products = cur.fetchall()
        return jsonify({'products': list(products)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/products', methods=['POST'])
@login_required
def add_product():
    email = session['user']['email']
    body  = request.get_json(silent=True) or {}
    name  = (body.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Product name required'}), 400
    if not _db_available:
        return jsonify({'error': 'Database not available'}), 503
    try:
        init_stock = float(body.get('init_stock', 0) or 0)
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO products
                  (user_email,name,category,unit,buying_price,selling_price,
                   current_stock,min_stock,description)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (user_email, name) DO UPDATE SET
                  category      = EXCLUDED.category,
                  unit          = EXCLUDED.unit,
                  buying_price  = EXCLUDED.buying_price,
                  selling_price = EXCLUDED.selling_price,
                  min_stock     = EXCLUDED.min_stock,
                  description   = EXCLUDED.description
                RETURNING id
            """, (email, name,
                  body.get('category','General'), body.get('unit','pcs'),
                  float(body.get('buying_price',0) or 0),
                  float(body.get('selling_price',0) or 0),
                  init_stock,
                  float(body.get('min_stock',10) or 10),
                  body.get('description','')))
            pid = cur.fetchone()[0]
            if init_stock > 0:
                cur.execute("""
                    INSERT INTO stock_in (user_email,product_id,product_name,quantity,buying_price,note)
                    VALUES (%s,%s,%s,%s,%s,%s)
                """, (email, pid, name, init_stock,
                      float(body.get('buying_price',0) or 0), 'Opening stock'))
        return jsonify({'success': True, 'id': pid})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/products/<int:pid>', methods=['PUT'])
@login_required
def update_product(pid):
    email = session['user']['email']
    body  = request.get_json(silent=True) or {}
    if not _db_available:
        return jsonify({'error': 'Database not available'}), 503
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE products SET name=%s, category=%s, unit=%s,
                  buying_price=%s, selling_price=%s, min_stock=%s
                WHERE id=%s AND user_email=%s
            """, (body.get('name',''), body.get('category','General'),
                  body.get('unit','pcs'),
                  float(body.get('buying_price',0) or 0),
                  float(body.get('selling_price',0) or 0),
                  float(body.get('min_stock',10) or 10),
                  pid, email))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/products/<int:pid>', methods=['DELETE'])
@login_required
def delete_product(pid):
    email = session['user']['email']
    if not _db_available:
        return jsonify({'error': 'Database not available'}), 503
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM products WHERE id=%s AND user_email=%s", (pid, email))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Stock In API ─────────────────────────────

@app.route('/api/stock/in', methods=['POST'])
@login_required
def stock_in():
    email = session['user']['email']
    body  = request.get_json(silent=True) or {}
    if not _db_available:
        return jsonify({'error': 'Database not available'}), 503
    pid = body.get('product_id')
    qty = float(body.get('quantity', 0) or 0)
    if not pid or qty <= 0:
        return jsonify({'error': 'Invalid product or quantity'}), 400
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            cur.execute("SELECT * FROM products WHERE id=%s AND user_email=%s", (pid, email))
            p = cur.fetchone()
            if not p:
                return jsonify({'error': 'Product not found'}), 404
            new_stock = float(p['current_stock'] or 0) + qty
            cur.execute("UPDATE products SET current_stock=%s WHERE id=%s", (new_stock, pid))
            cur.execute("""
                INSERT INTO stock_in
                  (user_email,product_id,product_name,quantity,buying_price,supplier,batch_no,expiry_date,note)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (email, pid, p['name'], qty,
                  float(body.get('buying_price',0) or 0),
                  body.get('supplier',''), body.get('batch_no',''),
                  body.get('expiry_date') or None,
                  body.get('note','')))
        return jsonify({'success': True, 'new_stock': new_stock})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/stock/history', methods=['GET'])
@login_required
def stock_history():
    email = session['user']['email']
    if not _db_available:
        return jsonify({'items': []})
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            cur.execute("""
                SELECT 'in' as type, product_name, quantity, buying_price as price,
                       supplier as note, created_at
                FROM stock_in WHERE user_email=%s
                UNION ALL
                SELECT 'out' as type, product_name, quantity, unit_price as price,
                       CONCAT('Invoice #', i.invoice_no) as note,
                       ii.created_at
                FROM invoice_items ii
                JOIN invoices i ON ii.invoice_id = i.id
                WHERE ii.user_email=%s
                ORDER BY created_at DESC LIMIT 100
            """, (email, email))
            items = cur.fetchall()
            # Format dates in Python (avoids mysql.connector %% escaping issues)
            for item in items:
                dt = item.get('created_at')
                if dt and hasattr(dt, 'strftime'):
                    item['created_at'] = dt.strftime('%d %b %Y %H:%M')
                elif dt:
                    item['created_at'] = str(dt)[:16]
        return jsonify({'items': items})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/customers')
@login_required
def customers_page():
    return render_template('customers.html', user=session['user'], active='customers')


# ─── Customers API ────────────────────────────

@app.route('/api/customers', methods=['GET'])
@login_required
def get_customers():
    email = session['user']['email']
    if not _db_available:
        return jsonify({'customers': []})
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            cur.execute("SELECT * FROM customers WHERE user_email=%s ORDER BY name", (email,))
            return jsonify({'customers': list(cur.fetchall())})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/customers', methods=['POST'])
@login_required
def add_customer():
    email = session['user']['email']
    body  = request.get_json(silent=True) or {}
    name  = (body.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    if not _db_available:
        return jsonify({'error': 'DB not available'}), 503
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO customers (user_email,name,phone,address,credit_limit)
                VALUES (%s,%s,%s,%s,%s)
            """, (email, name, body.get('phone',''), body.get('address',''),
                  float(body.get('credit_limit',0) or 0)))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/customers/<int:cid>', methods=['DELETE'])
@login_required
def delete_customer(cid):
    email = session['user']['email']
    if not _db_available:
        return jsonify({'error': 'DB not available'}), 503
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM customers WHERE id=%s AND user_email=%s", (cid, email))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/customers/<int:cid>/payment', methods=['POST'])
@login_required
def record_payment(cid):
    email  = session['user']['email']
    body   = request.get_json(silent=True) or {}
    amount = float(body.get('amount', 0) or 0)
    txn_type = body.get('type', 'payment')   # 'payment' or 'credit'
    if amount <= 0:
        return jsonify({'error': 'Invalid amount'}), 400
    if not _db_available:
        return jsonify({'error': 'DB not available'}), 503
    try:
        with get_db() as conn:
            chk = conn.cursor()
            chk.execute("SELECT id FROM customers WHERE id=%s AND user_email=%s", (cid, email))
            if not chk.fetchone():
                return jsonify({'error': 'Customer not found'}), 404
            chk.close()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO customer_payments (user_email,customer_id,amount,note,payment_mode,type)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, (email, cid, amount, body.get('note', ''), body.get('payment_mode', 'Cash'), txn_type))
            if txn_type == 'credit':
                # Credit sale: customer owes more money
                cur.execute("""
                    UPDATE customers
                    SET balance_due     = balance_due + %s,
                        total_purchased = total_purchased + %s
                    WHERE id=%s
                """, (amount, amount, cid))
            else:
                # Payment received: reduce what customer owes
                cur.execute("""
                    UPDATE customers
                    SET balance_due = GREATEST(0, balance_due - %s)
                    WHERE id=%s
                """, (amount, cid))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/customers/<int:cid>/transactions', methods=['GET'])
@login_required
def get_customer_transactions(cid):
    email = session['user']['email']
    if not _db_available:
        return jsonify({'transactions': []})
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            cur.execute("""
                SELECT type, amount, payment_mode, note, created_at
                FROM customer_payments WHERE customer_id=%s AND user_email=%s
                ORDER BY created_at DESC
            """, (cid, email))
            txns = cur.fetchall()
            for t in txns:
                dt = t.get('created_at')
                if dt and hasattr(dt, 'strftime'):
                    t['created_at'] = dt.strftime('%d %b %Y %H:%M')
                elif dt:
                    t['created_at'] = str(dt)[:16]
        return jsonify({'transactions': txns})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Invoices API ─────────────────────────────

@app.route('/api/invoices', methods=['POST'])
@login_required
def create_invoice():
    import random, string
    email = session['user']['email']
    body  = request.get_json(silent=True) or {}
    items = body.get('items', [])
    if not items:
        return jsonify({'error': 'No items in invoice'}), 400
    if not _db_available:
        return jsonify({'error': 'Database not available'}), 503
    inv_no = 'INV' + ''.join(random.choices(string.digits, k=6))
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            # Verify stock availability
            for it in items:
                cur.execute("SELECT current_stock, name FROM products WHERE id=%s AND user_email=%s",
                            (it['product_id'], email))
                p = cur.fetchone()
                if not p:
                    return jsonify({'error': f"Product not found"}), 404
                if float(p['current_stock'] or 0) < float(it['quantity']):
                    return jsonify({'error': f"Insufficient stock for {p['name']}. Available: {p['current_stock']}"}), 400
            # Create invoice
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO invoices
                  (user_email,invoice_no,customer_name,customer_phone,
                   subtotal,discount,tax_pct,tax_amount,total,payment_mode,status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'paid')
                RETURNING id
            """, (email, inv_no,
                  body.get('customer_name','Walk-in'),
                  body.get('customer_phone',''),
                  float(body.get('subtotal',0)), float(body.get('discount',0)),
                  float(body.get('tax_pct',0)), float(body.get('tax_amount',0)),
                  float(body.get('total',0)), body.get('payment_mode','Cash')))
            inv_id = cur.fetchone()[0]
            # Insert items & reduce stock
            for it in items:
                cur.execute("""
                    INSERT INTO invoice_items
                      (invoice_id,user_email,product_id,product_name,quantity,unit_price,total)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                """, (inv_id, email, it['product_id'], it['product_name'],
                      float(it['quantity']), float(it['unit_price']), float(it['total'])))
                cur.execute("""
                    UPDATE products SET current_stock = current_stock - %s
                    WHERE id=%s AND user_email=%s
                """, (float(it['quantity']), it['product_id'], email))
        return jsonify({'success': True, 'invoice_no': inv_no, 'invoice_id': inv_id,
                        'created_at': '', **body})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/invoices', methods=['GET'])
@login_required
def get_invoices():
    email = session['user']['email']
    if not _db_available:
        return jsonify({'invoices': []})
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            cur.execute("""
                SELECT i.*, COUNT(ii.id) as item_count
                FROM invoices i
                LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
                WHERE i.user_email=%s
                GROUP BY i.id
                ORDER BY i.created_at DESC
            """, (email,))
            invoices = list(cur.fetchall())
            for inv in invoices:
                if hasattr(inv.get('created_at'), 'strftime'):
                    inv['created_at'] = inv['created_at'].strftime('%Y-%m-%d %H:%M:%S')
        return jsonify({'invoices': invoices})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/invoices/<int:inv_id>', methods=['GET'])
@login_required
def get_invoice(inv_id):
    email = session['user']['email']
    if not _db_available:
        return jsonify({'error': 'DB not available'}), 503
    try:
        with get_db() as conn:
            cur = dict_cursor(conn)
            cur.execute("SELECT * FROM invoices WHERE id=%s AND user_email=%s", (inv_id, email))
            inv = dict(cur.fetchone()) if cur.fetchone() else None
            if not inv:
                return jsonify({'error': 'Not found'}), 404
            cur.execute("SELECT * FROM invoice_items WHERE invoice_id=%s", (inv_id,))
            inv['items'] = list(cur.fetchall())
            if hasattr(inv.get('created_at'), 'strftime'):
                inv['created_at'] = inv['created_at'].strftime('%Y-%m-%d %H:%M:%S')
        return jsonify(inv)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Entry Point ──────────────────────────────
if __name__ == '__main__':
    init_db()
    print('[OK] InvenVision running at http://127.0.0.1:5000\n')
    app.run(debug=True, port=5000)
