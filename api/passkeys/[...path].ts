import type { IncomingMessage, ServerResponse } from "node:http";
import { handlePasskeyApi } from "../../server/passkeys/index.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!(await handlePasskeyApi(req, res))) {
    res.statusCode = 404;
    res.end("Not found");
  }
}
