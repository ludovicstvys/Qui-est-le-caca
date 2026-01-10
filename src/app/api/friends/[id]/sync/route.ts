import { NextResponse } from "next/server";
import { syncFriendMatches } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const result = await syncFriendMatches(params.id, 10);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
