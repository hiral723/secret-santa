import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));

app.listen(3000, () => {
  console.log("🎅 Secret Santa running at http://localhost:3000");
});
