import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handlePasskeyApi } from "./passkeys/index.js";

const app = express();
app.disable("x-powered-by");
app.use(async (req, res, next) => {
  if (!(await handlePasskeyApi(req, res))) next();
});
const publicPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
app.use(express.static(publicPath));
app.get("/", (_req, res) => res.sendFile(path.join(publicPath, "index.html")));
app.use((_req, res) => res.status(404).send("Not found"));
const port = Number(process.env.PORT || 3000);
createServer(app).listen(port, () => console.log(`Web server listening on port ${port}`));
