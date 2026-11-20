# Monitor de Stock — Nintendo Switch 2 Zelda 40th Anniversary

Monitorea el SKU `121642` en Nintendo Store US y envía un mensaje por Telegram apenas detecta stock disponible.

## Configuración

1. Crea un bot en Telegram hablando con `@BotFather` (`/newbot`) y copia el **token**.
2. Escríbele cualquier mensaje a tu nuevo bot y obtén tu `chat_id` abriendo en el navegador:
   `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
   (busca `"chat":{"id":...}`).
3. Copia `.env.example` a `.env` y completa `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.

## Uso

- Probar envío a Telegram:
  ```powershell
  node --env-file-if-exists=.env monitor.mjs --test
  ```
- Comprobar el stock una sola vez:
  ```powershell
  node --env-file-if-exists=.env monitor.mjs --once
  ```
- Iniciar el monitor continuo:
  ```powershell
  node --env-file-if-exists=.env monitor.mjs
  ```
