// server.js — Flyers Mataró (Stripe Checkout con totales consolidados + IVA automático)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const app = express();
app.use(cors());
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Tarifas base (igual que en tu front) ---
const FILAS_BASE = [
  {q:25, u:0.36}, {q:50, u:0.20}, {q:100, u:0.12}, {q:250, u:0.04}, {q:500, u:0.02},
  {q:1000, u:0.01}, {q:2500, u:0.008}, {q:5000, u:0.006}, {q:7500, u:0.006},
  {q:10000, u:0.006}, {q:20000, u:0.006}, {q:30000, u:0.006}, {q:40000, u:0.006},
  {q:50000, u:0.006}, {q:75000, u:0.006}, {q:100000, u:0.005}, {q:125000, u:0.005}, {q:150000, u:0.005}
];
const ENVIO_NORMAL = 6.99;
const ENVIO_EXPRES = 15.60;
const GRAMAJE = { '0':0,'162.16':162.16,'138.97':138.97,'178.85':178.85,'165.30':165.30,'112.57':112.57 };
const IMPRESION = { '0':0, '5.76':5.76 };

const findFila = q => FILAS_BASE.find(f => f.q === q);

// Salud
app.get('/', (_, res) => res.send('OK 👍 Backend Flyers activo (producción)'));

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { cantidad, gramaje, impresion, envio } = req.body || {};
    const fila = findFila(Number(cantidad));
    if (!fila) return res.status(400).json({ error: 'Cantidad no permitida' });

    // 1) Cálculos (margen interno igual que en el front)
    const unit = fila.u * 1.20;
    const extraG = GRAMAJE[String(gramaje)];
    const extraI = IMPRESION[String(impresion)];
    if (extraG === undefined || extraI === undefined) {
      return res.status(400).json({ error: 'Extras no válidos' });
    }
    const envioImporte = envio === 'expres' ? ENVIO_EXPRES : ENVIO_NORMAL;

    const baseTotal = unit * fila.q;           // total de flyers
    const extrasTotal = (extraG + extraI);     // extras una sola vez
    const totalEstimado = baseTotal + extrasTotal + envioImporte;

    // Pasamos SIEMPRE a céntimos redondeando
    const toCents = (n) => Math.max(1, Math.round(n * 100)); // nunca 0 céntimos
    const baseTotalCents   = toCents(baseTotal);
    const extrasTotalCents = extrasTotal > 0 ? toCents(extrasTotal) : 0;
    const envioCents       = toCents(envioImporte);

    console.log('🧮 RESUMEN',
      { cantidad: fila.q, unit, baseTotal, extrasTotal, envioImporte, totalEstimado });

    // 2) line_items consolidados (evita precios unitarios < 0,01 €)
    const line_items = [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Flyers ${fila.q} uds`,
            description: 'Gramaje/impresión seleccionados'
          },
          unit_amount: baseTotalCents
        },
        quantity: 1
      }
    ];
    if (extrasTotalCents > 0) {
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Extras (gramaje/impresión)' },
          unit_amount: extrasTotalCents
        },
        quantity: 1
      });
    }
    line_items.push({
      price_data: {
        currency: 'eur',
        product_data: { name: `Envío ${envio === 'expres' ? 'Exprés' : 'Normal'}` },
        unit_amount: envioCents
      },
      quantity: 1
    });

    // 3) Sesión de Checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'es',
      currency: 'eur',
      line_items,
      // IVA automático (Stripe Tax debe estar activo en tu cuenta)
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['ES'] },
      tax_id_collection: { enabled: true },
      success_url: `${process.env.BASE_URL}/gracias?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/flyers?cancelled=1`,
      metadata: {
        cantidad: String(fila.q),
        gramaje: String(gramaje),
        impresion: String(impresion),
        envio: String(envio)
      }
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error('❌ Error creando Checkout Session:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Fallo creando la sesión' });
  }
});

const port = process.env.PORT || 4242;
app.listen(port, () => console.log(`Servidor Stripe en :${port}`));
