<script>
  async function pagarTarjetas(resumen){
    const envioSel = document.querySelector('input[name="envio"]:checked')?.value === 'expres' ? 'expres' : 'normal';

    const opciones = [
      `Esquinas: ${opcionTexto('esquinas')}`,
      `Orientación: ${opcionTexto('orientacion')}`,
      `Tamaño: ${opcionTexto('tamano')}`,
      `Material: ${opcionTexto('material')}`,
      `Impresión: ${opcionTexto('impresion')}`,
      `Acabado: ${opcionTexto('acabado')}`
    ].join(' | ');

    const payload = {
      product: 'tarjetas',
      cantidad: resumen.q,
      envio: envioSel,
      opciones_label: opciones,
      // enviamos extras por separado para que el backend los sume
      esquinas: Number(document.querySelector('input[name="esquinas"]:checked')?.value || 0),
      orientacion: Number(document.querySelector('input[name="orientacion"]:checked')?.value || 0),
      tamano: Number(document.querySelector('input[name="tamano"]:checked')?.value || 0),
      material: Number(document.querySelector('input[name="material"]:checked')?.value || 0),
      impresion: Number(document.querySelector('input[name="impresion"]:checked')?.value || 0),
      acabado: Number(document.querySelector('input[name="acabado"]:checked')?.value || 0),
    };

    try {
      const resp = await fetch(`${BACKEND_URL}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        let msg = 'Error al crear la sesión';
        try {
          const err = await resp.json();
          if (err?.error) msg = err.error;
        } catch {}
        throw new Error(msg);
      }

      const data = await resp.json();
      if (!data?.url) throw new Error('Respuesta sin URL de Checkout');
      window.location.href = data.url;
    } catch (e) {
      alert(`❌ No se pudo iniciar el pago.\n${e.message}`);
    }
  }
</script>
