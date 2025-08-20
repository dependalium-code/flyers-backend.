// server.js  (CommonJS)
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();
app.use(cors());
app.use(express.json());

// =====================
//  Configuración
// =====================
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error("❌ Falta STRIPE_SECRET_KEY en variables de entorno");
  process.exit(1);
}
const stripe = new Stripe(stripeSecret);

const SUCCESS_URL =
  process.env.SUCCESS_URL || "https://flyersmataro.com/success";
const CANCEL_URL =
  process.env.CANCEL_URL || "https://flyersmataro.com/cancel";

const ENVIO = { normal: 6.99, expres: 15.6 };
const MARGEN = 1.2;

// Tiers base (€ por unidad, sin margen) exactamente como en los frontends
const TIERS = {
  flyers: [
    { q: 25, u: 0.36 }, { q: 50, u: 0.20 }, { q: 100, u: 0.12 }, { q: 250, u: 0.04 },
    { q: 500, u: 0.02 }, { q: 1000, u: 0.01 }, { q: 2500, u: 0.008 },
    { q: 5000, u: 0.006 }, { q: 7500, u: 0.006 }, { q: 10000, u: 0.006 },
    { q: 20000, u: 0.006 }, { q: 30000, u: 0.006 }, { q: 40000, u: 0.006 },
    { q: 50000, u: 0.006 }, { q: 75000, u: 0.006 }, { q: 100000, u: 0.005 },
    { q: 125000, u: 0.005 }, { q: 150000, u: 0.005 }
  ],
  pegatinas: [
    { q: 50, u: 0.18 }, { q: 100, u: 0.12 }, { q: 250, u: 0.08 }, { q: 500, u: 0.06 },
    { q: 1000, u: 0.04 }, { q: 2500, u: 0.035 }, { q: 5000, u: 0.030 },
    { q: 10000, u: 0.028 }
  ],
  tarjetas: [
    { q: 50, u: 0.24 }, { q: 100, u: 0.12 }, { q: 250, u: 0.06 }, { q: 500, u: 0.04 },
    { q: 1000, u: 0.02 }, { q: 2500, u: 0.01 }, { q: 5000, u: 0.01 },
    { q: 7500, u: 0.009 }, { q: 10000, u: 0.009 }, { q: 20000, u: 0.008 },
    { q: 30000, u: 0.008 }, { q: 40000, u: 0.008 }, { q: 50000, u: 0.007 },
    { q: 75000, u: 0.007 }, { q: 100000, u: 0.007 }, { q: 125000, u: 0.007 },
    { q: 150000, u: 0.007 }, { q: 175000, u: 0.007 }, { q: 200000, u: 0.007 },
    { q: 250000, u: 0.006 }
  ],
};

// =====================
//  Helpers
// =====================
function num(n) {
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : 0;
}

function getUnit(product, cantidad) {
  const list = TIERS[product] || [];
  // Busca exacto; si no, coge el más cercano por arriba; si no, el último
  let found = list.find((t) => t.q === cantidad);
  if (!found) {
    found = list.find((t) => t.q >= cantidad) || list[list.length - 1];
  }
  if (!found) throw new Error(`No hay tarifa para ${product} (q=${cantidad})`);
  return found.u;
}

function getEnvioPrice(envio) {
  return envio === "expres" ? ENVIO.expres : ENVIO.normal;
}

function calcExtrasFromBody(body) {
  // Si viene extra_total, úsalo como prioridad
  if (typeof body.extra_total === "number") return num(body.extra_total);

  // Suma de todos los posibles extras numéricos que enviamos desde los frontends
  const fields = [
    "gramaje", "impresion",                 // flyers
    "material", "forma", "laminado", "tamano", // pegatinas
    "esquinas", "orientacion", "tamano", "material", "impresion", "acabado" // tarjetas
  ];
  // Evita duplicar tamano/impression si aparecen por partida doble
  const unique = Array.from(new Set(fields));
  return unique.reduce((acc, k) => acc + num(body[k]), 0);
}

function buildName(product, cantidad) {
  const map = {
    flyers: "Flyers",
    pegatinas: "Pegatinas",
    tarjetas: "Tarjetas de visita",
  };
  return `${map[product] || "Producto"} — ${cantidad.toLocaleString("es-ES")} uds`;
}

// =====================
//  Rutas
// =====================
app.get("/", (_req, res) => {
  res.send("✅ Backend de Flyers Mataró operativo");
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const {
      product,            // 'flyers' | 'pegatinas' | 'tarjetas'
      cantidad,           // número
      envio,              // 'normal' | 'expres'
      opciones_label,     // string legible (config elegida)
      // Extras sueltos (opcionales)
      gramaje, impresion, material, forma, laminado, tamano,
      esquinas, orientacion, acabado,
      // O bien un total directo:
      extra_total,
    } = req.body || {};

    if (!product || !cantidad) {
      return res.status(400).json({ error: "Faltan 'product' o 'cantidad'" });
    }

    // 1) Precio unitario (sin margen) + margen
    const unitBase = getUnit(product, Number(cantidad));
    const unitFinal = unitBase * MARGEN;

    // 2) Extras
    const extras = calcExtrasFromBody({
      gramaje, impresion, material, forma, laminado, tamano,
      esquinas, orientacion, acabado, extra_total,
    });

    // 3) Envío
    const envioPrice = getEnvioPrice(envio);

    // 4) Total pedido
    const subtotal = unitFinal * Number(cantidad);
    const total = subtotal + extras + envioPrice;

    // 5) Crea sesión de pago
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: buildName(product, Number(cantidad)),
              description: opciones_label || "",
              metadata: {
                product,
                cantidad: String(cantidad),
                envio: envio || "normal",
                opciones_label: opciones_label || "",
                // Guardamos también los extras para que te salgan en Stripe
                gramaje: gramaje ?? "",
                impresion: impresion ?? "",
                material: material ?? "",
                forma: forma ?? "",
                laminado: laminado ?? "",
                tamano: tamano ?? "",
                esquinas: esquinas ?? "",
                orientacion: orientacion ?? "",
                acabado: acabado ?? "",
                extra_total: extra_total ?? "",
                unit_base: String(unitBase),
                unit_final: String(unitFinal.toFixed(3)),
                envio_precio: String(envioPrice),
              },
            },
            unit_amount: Math.round(total * 100), // céntimos
          },
          quantity: 1,
        },
      ],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      // Si quieres factura/recibo por email:
      // customer_creation: "if_required",
      // allow_promotion_codes: true,
      // invoice_creation: { enabled: true },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: "No se pudo crear la sesión de pago" });
  }
});

// Healthcheck opcional
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend en puerto ${PORT}`);
});
