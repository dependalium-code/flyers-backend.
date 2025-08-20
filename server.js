// --- tablas base por producto (€/unidad) ---
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
  // si luego haces "tarjetas", añádelo aquí
};

const PRODUCT_NAMES = {
  flyers: 'Flyers',
  pegatinas: 'Pegatinas',
  // tarjetas: 'Tarjetas de visita'
};

// Suma segura de extras numéricos
function sumExtras(body) {
  const keys = [
    'gramaje','impresion','material','forma','laminado','tamano' // acepta todos
  ];
  return keys.reduce((acc,k)=>{
    const v = parseFloat(body?.[k] ?? 0);
    return acc + (isNaN(v) ? 0 : v);
  }, 0);
}

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { product='flyers', cantidad, envio='normal', opciones_label='' } = req.body || {};
    const table = PRICE_TABLES[product];
    if (!table) return res.status(400).json({ error: 'Producto no soportado' });

    const row = table.find(r => r.q === Number(cantidad));
    if (!row) return res.status(400).json({ error: 'Cantidad no soportada' });

    const unit = row.u * 1.20; // mismo margen que el front
    const extras = sumExtras(req.body); // ✅ suma cualquier campo extra numérico
    const envioCost = envio === 'expres' ? 15.60 : 6.99;

    const subtotal = unit * Number(cantidad) + extras + envioCost;

    // Stripe en EUR y céntimos
    const amountCents = Math.round(subtotal * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { 
            name: PRODUCT_NAMES[product] || 'Producto',
            description: opciones_label.slice(0, 500) // por si acaso
          },
          unit_amount: amountCents,
        },
        quantity: 1
      }],
      metadata: {
        product,
        cantidad: String(cantidad),
        envio,
        opciones: opciones_label
      },
      // 👇 repon estos con tus URLs
      success_url: `${process.env.BASE_URL}/gracias`,
      cancel_url: `${process.env.BASE_URL}/cancelado`,
      automatic_tax: { enabled: false }, // ya vas con IVA 21% en el total si lo aplicas tú
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la sesión' });
  }
});
