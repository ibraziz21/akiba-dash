// POST /api/admin/raffles/meta
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // service role (protected on server)
);

export async function POST(req: Request) {
  const body = await req.json();

  const {
    roundId,
    kind,
    cardTitle,
    description,
    cardImageUrl,
    prizeTitle,
    winners,
  } = body;

  if (!roundId || !kind) {
    return NextResponse.json(
      { error: "roundId and kind are required" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("raffle_meta")
    .upsert(
      {
        round_id: roundId,
        kind,
        card_title: cardTitle,
        description,
        card_image_url: cardImageUrl,
        prize_title: prizeTitle,
        winners,
      },
      { onConflict: "round_id" }
    );

  if (error) {
    console.error("Supabase raffle_meta upsert error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
