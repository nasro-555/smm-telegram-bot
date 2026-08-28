import http from "http";
import {
  pool
} from "../../db.js";
import {
  verifyHeleketWebhook
} from "./client.js";

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });

  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html)
  });

  res.end(html);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;

    if (total > 1_000_000) {
      throw new Error("BODY_TOO_LARGE");
    }

    chunks.push(chunk);
  }

  const raw = Buffer
    .concat(chunks)
    .toString("utf8");

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function handleWebhook(payload, bot) {
  if (!verifyHeleketWebhook(payload)) {
    const error = new Error("INVALID_HELEKET_SIGNATURE");
    error.statusCode = 401;
    throw error;
  }

  const orderId = String(payload.order_id ?? "");
  const status = String(payload.status ?? "");

  if (!orderId) {
    const error = new Error("MISSING_ORDER_ID");
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();
  let notification = null;

  try {
    await client.query("BEGIN");

    const depositResult = await client.query(
      `SELECT
         id,
         telegram_id,
         amount_usd,
         credited
       FROM deposits
       WHERE external_order_id = $1
       FOR UPDATE`,
      [orderId]
    );

    if (!depositResult.rowCount) {
      await client.query("COMMIT");
      return;
    }

    const deposit = depositResult.rows[0];

    await client.query(
      `UPDATE deposits
       SET status = $1,
           invoice_uuid = COALESCE($2, invoice_uuid),
           provider_payload = $3::jsonb,
           updated_at = NOW()
       WHERE id = $4`,
      [
        status || "unknown",
        payload.uuid ? String(payload.uuid) : null,
        JSON.stringify(payload),
        deposit.id
      ]
    );

    const successful =
      status === "paid" ||
      status === "paid_over";

    if (successful && !deposit.credited) {
      const amount = Number(deposit.amount_usd);

      await client.query(
        `UPDATE users
         SET balance = balance + $1
         WHERE telegram_id = $2`,
        [
          amount,
          deposit.telegram_id
        ]
      );

      await client.query(
        `UPDATE deposits
         SET credited = TRUE,
             credited_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [deposit.id]
      );

      const balanceResult = await client.query(
        `SELECT balance
         FROM users
         WHERE telegram_id = $1`,
        [deposit.telegram_id]
      );

      notification = {
        telegramId: deposit.telegram_id,
        amount,
        balance: Number(
          balanceResult.rows[0]?.balance ?? 0
        )
      };
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }

  if (notification && bot) {
    try {
      await bot.telegram.sendMessage(
        notification.telegramId,
        `✅ پرداخت Heleket تأیید شد.\n\n` +
        `💵 مبلغ افزوده‌شده: $${notification.amount.toFixed(2)}\n` +
        `💰 موجودی جدید: $${notification.balance.toFixed(2)}`
      );
    } catch (error) {
      console.error(
        "Heleket payment notification error:",
        error
      );
    }
  }
}

export function startHeleketServer(bot) {
  const port = Number(
    process.env.PORT || 8080
  );

  const server = http.createServer(
    async (req, res) => {
      try {
        const url = new URL(
          req.url || "/",
          "http://localhost"
        );

        if (
          req.method === "GET" &&
          url.pathname === "/"
        ) {
          return sendJson(
            res,
            200,
            {
              ok: true,
              service: "AFPLAY Telegram Bot",
              heleket: "ready"
            }
          );
        }

        if (
          req.method === "GET" &&
          (
            url.pathname === "/heleket/success" ||
            url.pathname === "/heleket/return"
          )
        ) {
          return sendHtml(
            res,
            200,
            `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AFPLAY</title>
</head>
<body style="font-family:sans-serif;padding:32px;text-align:center">
<h2>AFPLAY</h2>
<p>می‌توانید به تلگرام برگردید. وضعیت پرداخت به‌صورت خودکار بررسی می‌شود.</p>
</body>
</html>`
          );
        }

        if (
          req.method === "POST" &&
          url.pathname === "/webhooks/heleket"
        ) {
          const payload = await readJson(req);

          await handleWebhook(
            payload,
            bot
          );

          return sendJson(
            res,
            200,
            { ok: true }
          );
        }

        return sendJson(
          res,
          404,
          { ok: false, error: "not_found" }
        );
      } catch (error) {
        console.error(
          "HTTP/Heleket server error:",
          error
        );

        return sendJson(
          res,
          Number(error.statusCode || 500),
          {
            ok: false,
            error: String(
              error.message || "server_error"
            )
          }
        );
      }
    }
  );

  server.listen(
    port,
    "0.0.0.0",
    () => {
      console.log(
        `HTTP/Heleket server listening on port ${port}`
      );
    }
  );

  return server;
}
