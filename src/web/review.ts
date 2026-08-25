import type { PairConfig } from "../core/config";
import { splitLines } from "../helpers";
import { buildModel } from "../tui/model";
import type { TokenProvider } from "../tui/paint";
import { createTokenProvider } from "../tui/syntax";
import type { ReviewMessage } from "../transports/session";
import type { WebReview, WebRow } from "./review.types";

// A padding row has no line number and no content, so tokenising it would only cost time.
function tokensFor(text: string, lineNumber: number | null, tokens: TokenProvider) {
  return text === "" ? [] : tokens(text, lineNumber);
}

export async function toWebReview(review: ReviewMessage, config: PairConfig): Promise<WebReview> {
  const before = splitLines(review.before);
  const after = splitLines(review.after);
  const model = buildModel(before, after, config.context, config.minFold);

  const tokens = await createTokenProvider({
    path: review.path,
    enabled: config.syntax,
    truecolor: true,
  });

  const rows: WebRow[] = model.rows.map((row) => ({
    kind: row.kind,
    left: row.left,
    right: row.right,
    leftNumber: row.leftNumber,
    rightNumber: row.rightNumber,
    leftTokens: tokensFor(row.left, row.leftNumber, tokens),
    rightTokens: tokensFor(row.right, row.rightNumber, tokens),
  }));

  return { id: review.id, tool: review.tool, path: review.path, rows, folds: model.folds };
}
