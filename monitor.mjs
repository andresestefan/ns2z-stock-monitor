import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const PRODUCT_URL =
  process.env.PRODUCT_URL ||
  'https://www.nintendo.com/us/store/products/nintendo-switch-2-the-legend-of-zelda-40th-anniversary-edition-121642/';
const PRODUCT_SKU = process.env.PRODUCT_SKU || '121642';
const CHECK_INTERVAL_SECONDS = Number(process.env.CHECK_INTERVAL_SECONDS || 60);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const HISTORY_FILE = 'stock-history.log';
const STATE_FILE = 'state.json';

const args = new Set(process.argv.slice(2));
const isTest = args.has('--test');
const isOnce = args.has('--once');
const isCi = args.has('--ci');

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function recordHistory(event) {
  const line = `[${new Date().toLocaleString()}] ${event}\n`;
  appendFileSync(HISTORY_FILE, line, 'utf8');
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env');
  }

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}

async function checkStock() {
  const res = await fetch(PRODUCT_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Cache-Control': 'no-cache',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al consultar Nintendo Store`);
  }

  const html = await res.text();
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error('No se encontró __NEXT_DATA__ en la respuesta');
  }

  const end = html.indexOf('</script>', start);
  const nextData = JSON.parse(html.slice(start + marker.length, end));
  const state = nextData?.props?.pageProps?.initialApolloState;
  const product = state?.[`Product:{"sku":"${PRODUCT_SKU}"}`];

  if (!product) {
    throw new Error(`No se encontró el SKU ${PRODUCT_SKU} en los datos de la página`);
  }

  const priceObj = product['prices({"personalized":false})'];
  return {
    name: product.name,
    sku: product.sku,
    inStock: Boolean(product.isSalableQty),
    price: priceObj?.finalPrice ?? null,
    currency: priceObj?.currency ?? 'USD',
  };
}

async function main() {
  if (isTest) {
    await sendTelegram(`Prueba exitosa del monitor de Nintendo Store (SKU ${PRODUCT_SKU}).\n${PRODUCT_URL}`);
    log('Mensaje de prueba enviado a Telegram.');
    return;
  }

  if (isOnce) {
    const status = await checkStock();
    log(`${status.name} (SKU ${status.sku}) | Stock: ${status.inStock ? 'DISPONIBLE' : 'AGOTADO'} | Precio: ${status.price} ${status.currency}`);
    return;
  }

  if (isCi) {
    const prev = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null;
    const status = await checkStock();
    const label = status.inStock ? 'DISPONIBLE' : 'AGOTADO';
    log(`Stock: ${label} (${status.price} ${status.currency})`);

    if (!prev) {
      recordHistory(`INICIO | SKU ${status.sku} | ${label} | $${status.price} ${status.currency}`);
      writeFileSync(STATE_FILE, JSON.stringify({ inStock: status.inStock, updatedAt: new Date().toISOString() }, null, 2) + '\n');
    } else if (status.inStock !== prev.inStock) {
      recordHistory(`CAMBIO | SKU ${status.sku} | ${prev.inStock ? 'DISPONIBLE' : 'AGOTADO'} -> ${label} | $${status.price} ${status.currency}`);
      writeFileSync(STATE_FILE, JSON.stringify({ inStock: status.inStock, updatedAt: new Date().toISOString() }, null, 2) + '\n');
    }

    if (status.inStock && prev?.inStock !== true) {
      const msg =
        `¡HAY STOCK EN NINTENDO STORE!\n\n` +
        `${status.name}\n` +
        `Precio: $${status.price} ${status.currency}\n` +
        `${PRODUCT_URL}`;
      await sendTelegram(msg);
      log('Alerta enviada por Telegram.');
    }
    return;
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Error: configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en el archivo .env (usa .env.example como base).');
    process.exit(1);
  }

  log(`Iniciando monitor para SKU ${PRODUCT_SKU} cada ${CHECK_INTERVAL_SECONDS}s...`);
  let lastState = null;

  const runCheck = async () => {
    try {
      const status = await checkStock();
      const label = status.inStock ? 'DISPONIBLE' : 'AGOTADO';
      log(`Stock: ${label} (${status.price} ${status.currency})`);

      if (lastState === null) {
        recordHistory(`INICIO | SKU ${status.sku} | ${label} | $${status.price} ${status.currency}`);
      } else if (status.inStock !== lastState) {
        recordHistory(`CAMBIO | SKU ${status.sku} | ${lastState ? 'DISPONIBLE' : 'AGOTADO'} -> ${label} | $${status.price} ${status.currency}`);
      }

      if (status.inStock && lastState !== true) {
        const msg =
          `¡HAY STOCK EN NINTENDO STORE!\n\n` +
          `${status.name}\n` +
          `Precio: $${status.price} ${status.currency}\n` +
          `${PRODUCT_URL}`;
        await sendTelegram(msg);
        log('Alerta enviada por Telegram.');
      }

      lastState = status.inStock;
    } catch (err) {
      log(`Error en verificación: ${err.message}`);
    }
  };

  await runCheck();
  const timer = setInterval(runCheck, CHECK_INTERVAL_SECONDS * 1000);

  const stop = () => {
    clearInterval(timer);
    log('Monitor detenido.');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
