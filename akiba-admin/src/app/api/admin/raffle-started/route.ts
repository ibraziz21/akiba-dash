// app/api/admin/raffle-started/route.ts
import { NextRequest, NextResponse } from "next/server";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID =
  process.env.TELEGRAM_ANNOUNCE_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID;

// Optional: your app URL to include in the message
const APP_URL = process.env.APP_URL || "https://app.akibamiles.xyz";

function raffleTypeLabel(t: number): string {
  switch (t) {
    case 0:
      return "Single winner";
    case 1:
      return "Top 3 (50/30/20)";
    case 2:
      return "Top 5 (50/25/15/10/10)";
    case 3:
      return "Physical prize (NFT voucher)";
    default:
      return "Unknown type";
  }
}

export async function POST(req: NextRequest) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error(
      "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ANNOUNCE_CHAT_ID / TELEGRAM_ADMIN_CHAT_ID env vars."
    );
    return NextResponse.json(
      { error: "Telegram env vars not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();

    const {
      roundId,
      raffleType,
      isPhysical,
      tokenSymbol,
      tokenAddress,
      rewardHuman,
      ticketCostMiles,
      maxTickets,
      startTime,
      durationSeconds,
      rewardURI,
    } = body ?? {};

    if (!roundId) {
      return NextResponse.json(
        { error: "roundId is required" },
        { status: 400 }
      );
    }

    const typeLabel = raffleTypeLabel(Number(raffleType ?? 0));

    const startDate =
      typeof startTime === "number"
        ? new Date(startTime * 1000)
        : null;

    const durationHours =
      typeof durationSeconds === "number"
        ? Math.round(durationSeconds / 3600)
        : null;

    const lines: string[] = [];

    lines.push("🎉 *New AkibaMiles Raffle Started!*");
    lines.push("");
    lines.push(
      `• Round: *#${roundId}* (${typeLabel})`
    );

    if (isPhysical) {
      lines.push("• Prize: *Physical item* (NFT voucher)");
    } else if (rewardHuman && tokenSymbol) {
      lines.push(
        `• Prize pool: *${rewardHuman} ${tokenSymbol}*`
      );
    }

    if (tokenSymbol && tokenAddress) {
      lines.push(
        `• Reward token: \`${tokenSymbol}\` (\`${tokenAddress}\`)`
      );
    }

    if (ticketCostMiles) {
      lines.push(
        `• Ticket cost: *${ticketCostMiles} AkibaMiles*`
      );
    }

    if (maxTickets) {
      lines.push(`• Max tickets: *${maxTickets}*`);
    }

    if (startDate) {
      lines.push(
        `• Starts at: \`${startDate.toISOString()}\``
      );
    }

    if (durationHours !== null) {
      lines.push(
        `• Duration: ~*${durationHours} hours*`
      );
    }

    if (rewardURI) {
      lines.push("");
      lines.push(`Reward URI: ${rewardURI}`);
    }

    lines.push("");
    lines.push(
      `Join on AkibaMiles: ${APP_URL}`
    );

    const text = lines.join("\n");

    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      }
    );

    if (!tgRes.ok) {
      const errText = await tgRes.text().catch(() => "");
      console.error(
        "Telegram sendMessage failed",
        tgRes.status,
        errText
      );
      return NextResponse.json(
        {
          error: "Failed to send Telegram message",
          status: tgRes.status,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("raffle-started error", err);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
