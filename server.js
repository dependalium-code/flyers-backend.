// server.js — Backend único (Flyers + Tarjetas) con totales consolidados, IVA automático y metadata
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const app = express();
app.use(cors());
app.use(express.json());
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---------- PRECIOS ----------
const FILAS_FLYERS = [
  {q:25, u:0.36}, {q:50, u:0.20}, {q:100, u:0.12}, {q:250, u:0.04}, {q:500, u:0.02},
  {q:1000, u:0.01}, {q:2500, u:0.008}, {q:5000, u:0.006}, {q:7500, u:0.006},
  {q:10000, u:0.006}, {q:20000, u:0.006}, {q:30000, u:0.006}, {q:40000, u:0.006},
  {q:50000, u:0.006}, {q:75000, u:0.006}, {q:100000, u:0.005}, {q:125000, u:0.005}, {q:150000, u:0.005}
];

// Tarjetas (tu tabla BASE del HTML)
const FILAS_TARJETAS = [
  {q:50, u:0.24}, {q:100, u:0.12}, {q:250, u:0.06}, {q:500, u:0.04}, {q:1000, u:0.02},
  {q:2500, u:0.01}, {q:5000, u:0.01}, {q:7500, u:0.009}, {q:10000, u:0.009}, {q:20000, u:0.008},
  {q:30000, u:0.008}, {q:40000, u:0.008}, {q:50000, u:0.007}, {q:75000, u:0.007}, {q:100000, u:0.007},
  {q:125000, u:0.007}, {q:150000, u:0.007}, {q:175000, u:0.007}, {q:200000, u:0.007}, {q:250000, u:0.006}
];

const ENVIO_NORMAL = 6.99;
const ENVIO_EXPRES = 15.60;
const MARGEN = 1.20; // mismo +20% que usas en el front

const GRAMAJE_FLYERS = { '0':0,'162.16':162.16,'138.97':138.97,'178.85':178.85,'165.30':165.30,'112.57':112.57 };
const IMPRESION_FLYERS = { '0':0, '5.76':5.76 };

// Para tarjetas, de momento recibimos un extra_total desde el front (suma de esquinas, tamaño, material, impresión, acabado * margen)
// y además puedes enviar material/impresión por separado si quieres verlos en metadata.
function findFila(list, q){ return list.find(f => f.q === q); }
const toCents = (n)=> Math.max(1, Math.round(Number(n) * 100)); // nunca 0 céntimos

app.get('/', (_, res)=> res.send('OK 👍 Backend Flyers/Tarjetas activo'));

app.post('/create-checkout-session', async (req, res) => {
  try {
    const {
      product = 'flyers',
      cantidad,
      // Para flyers:
      gramaje, impresion,
      // Para tarjetas:
      extra_total, // suma consolidada de extras desde el front (ya con margen)
      opciones_label = '', // resumen legible de opciones para metadata
      envio
    } = req.body || {};

    // --- Selección de tabla y nombre de producto ---
    const isTarjetas = product === 'tarjetas';
    const filas = isTarjetas ? FILAS_TARJETAS : FILAS_FLYERS;
    const fila = findFila(filas, Number(cantidad));
    if (!fila) return res.status(400).json({ error: 'Cantidad no permitida' });

    const unit = Number(fila.u) * MARGEN;

    // Envío
    const envioImporte = envio === 'expres' ? ENVIO_EXPRES : ENVIO_NORMAL;

    let baseTotal = unit * fila.q; // total base del producto (con margen)
    let extrasTotal = 0;

    if (isTarjetas) {
      // Tarjetas: extras calculados en el front y enviados consolidados
      const extraFromFront = Number(extra_total || 0);
      if (Number.isNaN(extraFromFront)) return res.status(400).json({ error: 'Extra total inválido' });
      extrasTotal = extraFromFront;
    } else {
      // Flyers: extras desde mapas
      const extraG = GRAMAJE_FLYERS[String(gramaje)];
      const extraI = IMPRESION_FLYERS[String(impresion)];
      if (extraG === undefined || extraI === undefined) {
        return res.status(400).json({ error: 'Extras de flyers no válidos' });
      }
      extrasTotal = (Number(extraG) + Number(extraI));
    }

    // Totales en céntimos (consolidado en line_items para evitar céntimos < 1)
    const baseCents   = toCents(baseTotal);
    const extrasCents = extrasTotal > 0 ? toCents(extrasTotal) : 0;
    const envioCents  = toCents(envioImporte);

    const nombreProducto = isTarjetas
      ? `Tarjetas de visita ${fila.q} uds`
      : `Flyers ${fila.q} uds`;

    const line_items = [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: nombreProducto,
            description: isTarjetas ? 'Configuración personalizada' : 'Gramaje/impresión seleccionados'
          },
          unit_amount: baseCents
        },
        quantity: 1
      }
    ];
    if (extrasCents > 0) {
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: { name: isTarjetas ? 'Extras tarjetas' : 'Extras (gramaje/impresión)' },
          unit_amount: extrasCents
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

    const successPath = isTarjetas ? '/gracias-tarjetas' : '/gracias';
    const cancelPath  = isTarjetas ? '/tarjetas-de-visita' : '/flyers';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'es',
      currency: 'eur',
      line_items,
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['ES'] },
      tax_id_collection: { enabled: true },
      success_url: `${process.env.BASE_URL}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}${cancelPath}?cancelled=1`,
      // 🔎 Aquí queda todo para producción
      metadata: {
        product,
        cantidad: String(fila.q),
        envio: String(envio || 'normal'),
        // Flyers
        gramaje: isTarjetas ? '' : String(gramaje ?? ''),
        impresion: isTarjetas ? '' : String(impresion ?? ''),
        // Tarjetas
        extra_total: isTarjetas ? String(extra_total ?? '0') : '',
        opciones: isTarjetas ? String(opciones_label ?? '') : ''
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
