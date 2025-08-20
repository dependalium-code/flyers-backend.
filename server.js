// server.js
// Backend simple para Stripe Checkout — Flyers Mataró
// Soporta productos "flyers" y "pegatinas" y suma extras flexibles.

const express = require('express');
const cors = require('cors');

// Si usas .env en desarrollo local
try { require('dotenv').config(); } catch (_) {}

const app = express();

// --- Configuración CORS (orígenes permitidos) ---
const defaultOrigins = [
  'https://flyersmataro.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
];
const extraOrigins = (process.env.FRONT_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultOrigins, ...extraOrigins]));

app.use(cors({
  origin: (origin, cb) => {
    // permitir peticiones sin origin (curl, etc.)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origen no permitido por CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
}));

app.use(express.json());

// --- Stripe ---
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('⚠️ Falta STRIPE_SECRET_KEY en variables de entorno.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');

// --- Tablas base por producto (€/unidad sin margen) ---
const PRICE_TABLES = {
  flyers: [
    {q:25,u:0.36},{q:50,u:0.20},{q:100,u:0.12},{q:250,u:0.04},{q:500,u:0.02},
    {q:1000,u:0.01},{q:2500,u:0.008},{q:5000,u:0.006},{q:7500,u:0.006},
    {q:10000,u:0.006},{q:20000,u:0.006},{q:30000,u:0.006},{q:40000,u:0.006},
    {q:50000,u:0.006},{q:75000,u:0.006},{q:100000,u:0.005},{q:125000,u:0.005},{q:150000,u:0.005}
  ],
  pegatinas: [
    {q:50,u:0.18},{q:100,u:0.12},{q:250,u:0.08},{q:500,u:0.06},
    {q:1000,u:0.04},{q:2500,u:0.035},{q:5000,u:0.030},{q:10000,u:0.028}
  ],
  // Añade aquí "tarjetas" o lo que necesites
};

const PRODUCT_NAMES = {
  flyers: 'Flyers',
  pegatinas: 'Pegatinas',
};

// Margen interno (debe coincidir con el front)
const INTERNAL_MARGIN = 1.20;

// IVA opcional desde entorno (ej. 0.21)
const VAT_RATE = parseFloat(process.env.VAT_RATE || '0'); // 0 = sin IVA
const applyVAT = VAT_RATE > 0;

// Costes de envío
const SHIPPING = { normal: 6.99, expres: 15.60 };

// --- Utilidades ---
function sumExtras(body) {
  // Suma de todas las opciones numéricas que podamos recibir
  const keys = ['gramaje','impresion','material','forma','laminado','tamano'];
  return keys.reduce((acc, k) => {
    const v = parseFloat(body?.[k] ?? 0);
    return acc + (isNaN(v) ? 0 : v);
  }, 0);
}

function pickRow(table, qty) {
  // Busca exacta; si no, la más cercana para no romper el flujo
  const exact = table.find(r => r.q === qty);
  if (exact) return exact;
  return table.reduce((prev, cur) =>
    Math.abs(cur.q - qty) < Math.abs(prev.q - qty) ? cur : prev
  );
}

// --- Healthcheck ---
app.get('/', (_req, res) => res.json({ ok: true, service: 'flyers-backend' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// --- Endpoint principal ---
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { product = 'flyers', cantidad, envio = 'normal', opciones_label = '' } = req.body || {};

    // Validaciones básicas
    const table = PRICE_TABLES[product];
    if (!table) {
      return res.status(400).json({ error: 'Producto no soportado', debug: { product } });
    }
    const qty = Number(cantidad);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida', debug: { cantidad } });
    }
    if (!process.env.BASE_URL) {
      return res.status(500).json({ error: 'Falta BASE_URL en variables de entorno' });
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Falta STRIPE_SECRET_KEY en variables de entorno' });
    }

    // Precio base
    const row = pickRow(table, qty);
    const unit = row.u * INTERNAL_MARGIN;

    // Extras y envío
    const extrasTotal = sumExtras(req.body);
    const shipping = envio === 'expres' ? SHIPPING.expres : SHIPPING.normal;

    // Subtotal
    let total = unit * qty + extrasTotal + shipping;

    // IVA opcional
    if (applyVAT) total *= (1 + VAT_RATE);

    // Límites Stripe
    if (total < 0.50) {
      return res.status(400).json({ error: 'Importe demasiado bajo', debug: { total } });
    }

    const amountCents = Math.round(total * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: PRODUCT_NAMES[product] || 'Producto',
            description: (opciones_label || '').slice(0, 500),
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      metadata: {
        product,
        cantidad: String(qty),
        envio,
        opciones: opciones_label || '',
      },
      success_url: `${process.env.BASE_URL}/gracias`,
      cancel_url: `${process.env.BASE_URL}/cancelado`,
      // Si activas VAT_RATE, deja automatic_tax en false (ya lo sumamos).
      automatic_tax: { enabled: false },
    });

    res.json({ url: session.url, debug: { total, amountCents } });

  } catch (e) {
    console.error('Stripe error:', e?.message, e);
    res.status(500).json({ error: 'No se pudo crear la sesión', details: e?.message });
  }
});

// --- Arranque ---
const PORT = process.env.PORT || 10000; // Render usa 10000 por defecto
app.listen(PORT, () => {
  console.log(`✅ Backend online en puerto ${PORT}`);
});
