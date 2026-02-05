import { NextResponse } from "next/server";
import { pendingUserInputs } from "../route";
import type { ToolRequestUserInputAnswer } from "@/infrastructure/codex/schemas/v2";

interface AnswerRequestBody {
  itemId: string;
  answers: { [key: string]: ToolRequestUserInputAnswer };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnswerRequestBody;
    const { itemId, answers } = body;

    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json(
        { error: "itemId is required" },
        { status: 400 },
      );
    }

    if (!answers || typeof answers !== "object") {
      return NextResponse.json(
        { error: "answers is required" },
        { status: 400 },
      );
    }

    const pending = pendingUserInputs.get(itemId);
    if (!pending) {
      return NextResponse.json(
        { error: "No pending user input request found for this itemId" },
        { status: 404 },
      );
    }

    // Resolve the pending promise with the user's answers
    pending.resolve({ answers });
    pendingUserInputs.delete(itemId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error processing user input answer:", error);
    return NextResponse.json(
      { error: "Failed to process answer" },
      { status: 500 },
    );
  }
}
