// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const app = express();
app.use(cors());
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Reglas de precio (mismas que en tu HTML) ---
const FILAS_BASE = [
  {q:25, u:0.36}, {q:50, u:0.20}, {q:100, u:0.12}, {q:250, u:0.04}, {q:500, u:0.02},
  {q:1000, u:0.01}, {q:2500, u:0.008}, {q:5000, u:0.006}, {q:7500, u:0.006},
  {q:10000, u:0.006}, {q:20000, u:0.006}, {q:30000, u:0.006}, {q:40000, u:0.006},
  {q:50000, u:0.006}, {q:75000, u:0.006}, {q:100000, u:0.005}, {q:125000, u:0.005}, {q:150000, u:0.005}
];
const ENVIO_NORMAL = 6.99;
const ENVIO_EXPRES = 15.60;

const GRAMAJE = {
  '0': 0, '162.16': 162.16, '138.97': 138.97, '178.85': 178.85, '165.30': 165.30, '112.57': 112.57
};
const IMPRESION = { '0': 0, '5.76': 5.76 };

function findFila(q) { return FILAS_BASE.find(f => f.q === q); }

app.get('/', (_, res) => res.send('OK 👍 Backend Flyers activo'));

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { cantidad, gramaje, impresion, envio } = req.body || {};

    const fila = findFila(Number(cantidad));
    if (!fila) return res.status(400).json({ error: 'Cantidad no permitida' });

    const unit = fila.u * 1.20;
    const extraG = GRAMAJE[String(gramaje)];
    const extraI = IMPRESION[String(impresion)];
    if (extraG === undefined || extraI === undefined) {
      return res.status(400).json({ error: 'Extras no válidos' });
    }
    const envioImporte = envio === 'expres' ? ENVIO_EXPRES : ENVIO_NORMAL;

    const taxRates = process.env.STRIPE_TAX_RATE_21 ? [process.env.STRIPE_TAX_RATE_21] : [];

    const line_items = [
      {
        price_data: {
          currency: 'eur',
          product_data: { name: `Flyers ${fila.q} uds`, description: `Gramaje/impresión a medida` },
          unit_amount: Math.round(unit * 100)
        },
        quantity: fila.q,
        tax_rates: taxRates
      }
    ];

    const extrasTotal = (extraG + extraI);
    if (extrasTotal > 0) {
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Extras (gramaje/impresión)' },
          unit_amount: Math.round(extrasTotal * 100)
        },
        quantity: 1,
        tax_rates: taxRates
      });
    }

    line_items.push({
      price_data: {
        currency: 'eur',
        product_data: { name: `Envío ${envio === 'expres' ? 'Exprés' : 'Normal'}` },
        unit_amount: Math.round(envioImporte * 100)
      },
      quantity: 1,
      tax_rates: taxRates
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'es',
      currency: 'eur',
      line_items,
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['ES'] },
      tax_id_collection: { enabled: true },
      success_url: `${process.env.BASE_URL}/gracias?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/flyers?cancelled=1`,
      metadata: { cantidad: String(fila.q), gramaje: String(gramaje), impresion: String(impresion), envio: String(envio) }
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la sesión de pago' });
  }
});

const port = process.env.PORT || 4242;
app.listen(port, () => console.log(`Servidor Stripe escuchando en :${port}`));
