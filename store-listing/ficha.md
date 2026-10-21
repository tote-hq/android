# Ficha de Changuito para el dApp Store

Textos e imágenes para [publish.solanamobile.com](https://publish.solanamobile.com). Medidas según la guía de listing y el spec v0.4.0 del release NFT.

| Archivo | Uso | Medida |
|---|---|---|
| `icon-512.png` | Ícono de la ficha. Mascota sobre girasol `#F4B942` | 512×512 PNG |
| `icon-foreground.png` | Frente del ícono adaptativo de la shell (fondo transparente). No hace falta subirlo a la ficha | 512×512 PNG |
| `banner-1200x600.png` | Banner (`purpose: banner`) | 1200×600 PNG |
| `feature-graphic-1200.png` | Feature graphic del spec (`purpose: featureGraphic`) | 1200×1200 PNG |
| `web-manifest.json` | Manifest local con el que `webshell init` tomó nombre, colores e ícono. La tienda en vivo todavía no publica uno | — |

Los íconos salen de `apps/branding/logo/isotipo-mascota.png` y el wordmark de `apps/branding/logo/wordmark.png`.

## Descripción corta

Máximo 30 caracteres, contados.

| Idioma | Texto | Caracteres |
|---|---|---|
| Español | Tu súper, pagado en USDC | 24 |
| English | Groceries, paid in USDC | 23 |

## Descripción larga

### Español — publicar mientras la app siga en devnet

Changuito arma la compra del súper en Argentina.

Pedís en español lo que necesitás. Un agente busca en el catálogo de un supermercado, compara precios y deja el carrito armado, con el total a la vista.

El pago es en USDC y queda en un escrow de Solana. Si el pedido se concreta, el escrow se libera. Si no, el USDC vuelve. Nadie aprueba eso a mano.

Esta versión corre en Solana devnet, con USDC de prueba.

### English — while the app is still on devnet

Changuito does the grocery shop in Argentina.

Ask for what you need. An agent searches a supermarket catalogue, compares prices and leaves the cart ready, with the total in view.

You pay in USDC. The funds sit in a Solana escrow until the order is placed. If it is not placed, the USDC comes back. Nobody approves that by hand.

This version runs on Solana devnet, with test USDC.

### Cuando haya mainnet

Borrar el último párrafo de cada idioma. No reemplazarlo por una frase que prometa liquidación en mainnet antes de que el checkout de `sol.changuito.me` esté en mainnet.

## Capturas

La guía pide, para todas:

- 1080 px o más de ancho y de alto
- la misma orientación
- la misma relación de aspecto

Para un teléfono, usar **retrato 1080×1920** en todas. Mínimo 4. Subir estas 6, en este orden, sacadas de la app en un Android (la shell o el sitio en 390 px de ancho, luego exportadas a 1080×1920 sin recortar una y estirar otra):

1. **Inicio.** La conversación vacía, con la mascota y el campo para pedir la compra.
2. **Código postal.** El agente pidiendo el CPA antes de buscar.
3. **Productos.** La grilla con foto, nombre y precio de una búsqueda.
4. **Carrito.** Las líneas, el total y el botón de pago.
5. **Pago.** El escrow en USDC: monto, red, y que es devnet o USDC de prueba si la pantalla lo dice.
6. **Resultado.** Pedido concretado o reembolso, con el motivo en palabras de la app.

No mezclar capturas de escritorio con capturas de teléfono. No usar las piezas de `creatives/` ni los banners de redes: no son la app.

### Video

Opcional en la guía, presente en el spec. Si se sube: `.mp4`, 720 px como mínimo de ancho y de alto, mejor 1080×1920, el mismo recorrido de las capturas 1 a 6. No hace falta para armar la ficha; sí ayuda en la revisión.
