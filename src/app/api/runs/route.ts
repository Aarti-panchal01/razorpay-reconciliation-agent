import { NextResponse } from "next/server";
import { listRecentRuns } from "@/lib/persist-run";

export async function GET() {
  const runs = await listRecentRuns(20);
  return NextResponse.json({ runs });
}
