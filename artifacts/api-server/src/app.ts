import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { authMiddleware } from "./middlewares/authMiddleware";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
// Gzip every compressible response and stream it chunked. Two jobs in one:
// large JSON payloads (/api/incidents over a year is tens of MB raw) shrink
// ~10x on the wire, AND the response loses its Content-Length — Google
// Frontend hard-kills non-chunked responses over 32 MB, which is exactly how
// the production dashboard went all-zero once the incidents table grew past
// that line while the API kept logging 200s.
app.use(compression());
app.use(cookieParser());
// Spot reports embed photographs as base64 data URLs inside the JSON body, so
// the default 100 KB limit would 413 a normal multi-photo save. The per-photo
// and total-size ceilings are enforced in the spot-reports route.
app.use(express.json({ limit: "32mb" }));
app.use(express.urlencoded({ extended: true, limit: "32mb" }));
app.use(authMiddleware);

app.use("/api", router);

export default app;
