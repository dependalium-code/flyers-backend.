// server.js (mínimo para diagnosticar)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const app = express();
app.use(cors());
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Salud
app.get('/', (_, res) => res.send('OK 👍 Backend Flyers activo (demo)'));

// Ignora la configuración del front y crea SIEMPRE una sesión de 10,00 €
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: 'eur',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Prueba Flyers (demo 10€)' },
          unit_amount: 1000          // 10,00 €
        },
        quantity: 1
      }],
      // SIN impuestos/IVA para aislar el problema
      // automatic_tax: { enabled: true },
      success_url: `${process.env.BASE_URL}/gracias?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/flyers?cancelled=1`
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error('❌ Error Checkout minimal:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Fallo creando la sesión' });
  }
});

const port = process.env.PORT || 4242;
app.listen(port, () => console.log(`Servidor mínimo Stripe en :${port}`));
