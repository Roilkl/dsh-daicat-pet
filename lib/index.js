/**
 * Host half of dsh-daicat-pet.
 *
 * The pet itself is rendered by the Client half (`./client`). This half serves
 * the pet's own assets over HTTP (the browser cannot read files) and reports
 * the token cost of each finished turn:
 *
 *   GET /dsh-daicat-pet/anim.json    -> frame table (per-state frame count + per-frame ms)
 *   GET /dsh-daicat-pet/atlas.webp   -> sprite atlas (192x208 cells, grid of cols x rows)
 *   GET /dsh-daicat-pet/api/state    -> { petId, size, cell, sheet, pose, override }
 *   GET /dsh-daicat-pet/api/lines    -> click lines (pre-written chatter, from lines.json)
 *   GET /dsh-daicat-pet/api/turn     -> latest finished turn: token buckets + a bumping seq
 *   GET /dsh-daicat-pet/api/pose?set=<state>&ms=<n>  -> force a pose (debugging / manual test)
 *
 * Token accounting reads the `tokenUsage` session projection (cumulative
 * per-session buckets reported by the provider) and diffs it against the totals
 * seen at the previous turn end. That is provider-exact and needs no replayed
 * event fold, and it survives retries because the projection already replaces a
 * retried attempt instead of double counting it.
 *
 * The atlas is free-form: any column count, any per-state frame count, and a
 * per-state loop count that merely repeats the duration list. Nothing here
 * assumes the petdex 8x9 / 59-frame geometry.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "/dsh-daicat-pet";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEFAULT_SIZE = 192;
const TURN_SETTLE_MS = 250;
const HERE = dirname(fileURLToPath(import.meta.url));

export const inject = ["webServer"];
export const name = "dsh-daicat-pet";

let forcedPose = null; // { pose, until }

function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

/** Pet data shipped inside this package: <pkg>/assets/daicat */
function bundledPetDir() {
  return resolve(HERE, "..", "assets", "daicat");
}

/** Pet data the user may keep outside the package (rebuild target). */
function userPetDir() {
  return join(dshHome(), "desktop-pet", "pets", "daicat");
}

function looksLikePetDir(dir) {
  if (typeof dir !== "string" || dir === "") return false;
  try {
    return existsSync(join(dir, "anim.json"));
  } catch {
    return false;
  }
}

/**
 * Precedence: explicit `petDir` config > assets shipped with this package >
 * the user's own pet directory. Shipping the assets means a fresh install just
 * works, while an explicit petDir keeps a local rebuild loop (daicat_build.py)
 * ahead of the bundled copy.
 */
function resolvePetDir(configured) {
  if (typeof configured === "string" && configured !== "") return resolve(configured);
  const bundled = bundledPetDir();
  if (looksLikePetDir(bundled)) return bundled;
  return userPetDir();
}

async function sendFile(response, file, contentType) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    json(response, 404, {
      error: "pet asset not found",
      file,
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": String(bytes.byteLength),
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  response.end(bytes);
}

const ZERO = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function totalsOf(values) {
  const usage = values && typeof values === "object" ? values.tokenUsage : undefined;
  if (!usage || typeof usage !== "object") return null;
  const pick = (key) => {
    const value = Number(usage[key]);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  return {
    uncachedInputTokens: pick("uncachedInputTokens"),
    outputTokens: pick("outputTokens"),
    cacheReadTokens: pick("cacheReadTokens"),
    cacheWriteTokens: pick("cacheWriteTokens"),
  };
}

function diffTotals(next, previous) {
  const base = previous ?? ZERO;
  return {
    uncachedInputTokens: Math.max(0, next.uncachedInputTokens - base.uncachedInputTokens),
    outputTokens: Math.max(0, next.outputTokens - base.outputTokens),
    cacheReadTokens: Math.max(0, next.cacheReadTokens - base.cacheReadTokens),
    cacheWriteTokens: Math.max(0, next.cacheWriteTokens - base.cacheWriteTokens),
  };
}

function sessionKey(session) {
  if (!session) return "";
  const id = session.id ?? session.sessionId ?? session.key;
  return id === undefined || id === null ? "" : String(id);
}

export function apply(ctx, config) {
  const cfg = config ?? ctx.config ?? {};
  const petDir = resolvePetDir(cfg.petDir);
  const petId = String(cfg.petId ?? "daicat");
  const size = Number(cfg.size ?? DEFAULT_SIZE) || DEFAULT_SIZE;
  const animPath = join(petDir, "anim.json");
  const atlasPath = join(petDir, "spritesheet.webp");
  const linesPath = join(petDir, "lines.json");

  /* ----------------------------------------------------------- turn accounting */

  const totalsBySession = new Map(); // session key -> cumulative buckets already accounted for
  const pendingTurns = new Map(); // session key -> timer
  let turnRecord = { seq: 0, at: 0, turn: 0, session: "", buckets: { ...ZERO }, totalTokens: 0 };

  // The projection registry is an optional peer: mount a child scope that waits
  // for it, so the pet still works (sprite, pose, chatter) when token accounting
  // is unavailable instead of the whole plugin failing to activate.
  let projectionRegistry = null;
  if (typeof ctx.inject === "function") {
    try {
      ctx.inject(["sessionProjections"], (scope) => {
        projectionRegistry = scope.sessionProjections ?? scope.get("sessionProjections") ?? null;
      });
    } catch {
      projectionRegistry = null;
    }
  }

  const projections = () => projectionRegistry;

  const snapshotTotals = (session) => {
    const registry = projections();
    if (!registry || typeof registry.snapshot !== "function") return null;
    try {
      const snapshot = registry.snapshot(session);
      return totalsOf(snapshot && snapshot.values);
    } catch {
      return null;
    }
  };

  const settleTurn = (session, turn) => {
    const key = sessionKey(session);
    const totals = snapshotTotals(session);
    if (totals === null) return;
    const previous = totalsBySession.get(key);
    totalsBySession.set(key, totals);
    const buckets = diffTotals(totals, previous);
    const totalTokens =
      buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
    if (totalTokens <= 0) return;
    turnRecord = {
      seq: turnRecord.seq + 1,
      at: Date.now(),
      turn: Number(turn) || 0,
      session: key,
      buckets,
      totalTokens,
    };
  };

  ctx.effect(() => {
    const off = ctx.on("session/event", (session, event) => {
      try {
        if (!event) return;
        if (event.type === "turn/start") {
          const key = sessionKey(session);
          if (pendingTurns.has(key)) {
            clearTimeout(pendingTurns.get(key));
            pendingTurns.delete(key);
          }
          // Establish a baseline when this is the first turn we ever see for the
          // session, so "this turn" never absorbs history from earlier sessions.
          if (!totalsBySession.has(key)) {
            const totals = snapshotTotals(session);
            if (totals !== null) totalsBySession.set(key, totals);
          }
          return;
        }
        if (event.type !== "turn/end") return;
        const turn = event.data ? event.data.turn : 0;
        const key = sessionKey(session);
        const previous = pendingTurns.get(key);
        if (previous !== undefined) clearTimeout(previous);
        // The projection folds committed events; give the tail of the turn a
        // moment to land before diffing, otherwise the last step leaks into the
        // next turn's count.
        const timer = setTimeout(() => {
          pendingTurns.delete(key);
          try {
            settleTurn(session, turn);
          } catch {
            /* accounting is best effort */
          }
        }, TURN_SETTLE_MS);
        if (timer && typeof timer.unref === "function") timer.unref();
        pendingTurns.set(key, timer);
      } catch {
        /* never break the harness event bus */
      }
    });
    return () => {
      off?.();
      for (const timer of pendingTurns.values()) clearTimeout(timer);
      pendingTurns.clear();
    };
  });

  const effectiveForcedPose = () => {
    if (forcedPose !== null && forcedPose.until !== 0 && Date.now() > forcedPose.until) forcedPose = null;
    return forcedPose;
  };

  /* ------------------------------------------------------------------- routing */

  const handler = async (request, response) => {
    let path;
    let url;
    try {
      const authority = new URL(`http://${request.headers.host ?? ""}`);
      if (!LOOPBACK.has(authority.hostname)) {
        json(response, 403, { error: "untrusted host" });
        return;
      }
      url = new URL(request.url ?? "/", authority);
      path = url.pathname;
      if (path === `${BASE}/api/pose`) {
        const state = url.searchParams.get("set");
        const ms = Number(url.searchParams.get("ms") ?? 0) || 0;
        if (state === null || state === "") forcedPose = null;
        else forcedPose = { pose: state, until: ms > 0 ? Date.now() + ms : 0 };
        json(response, 200, { ok: true, override: forcedPose });
        return;
      }
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { error: "method not allowed" });
      return;
    }
    if (path === `${BASE}/anim.json`) {
      await sendFile(response, animPath, "application/json; charset=utf-8");
      return;
    }
    if (path === `${BASE}/atlas.webp`) {
      await sendFile(response, atlasPath, "image/webp");
      return;
    }
    if (path === `${BASE}/api/lines`) {
      await sendFile(response, linesPath, "application/json; charset=utf-8");
      return;
    }
    if (path === `${BASE}/api/turn`) {
      json(response, 200, { ok: true, ...turnRecord, buckets: turnRecord.buckets });
      return;
    }
    if (path === `${BASE}/api/state`) {
      json(response, 200, {
        ok: true,
        petId,
        size,
        petDir,
        anim: animPath,
        atlas: atlasPath,
        lines: linesPath,
        override: effectiveForcedPose(),
        turn: { seq: turnRecord.seq, at: turnRecord.at },
      });
      return;
    }
    json(response, 404, { error: "not found", path });
  };

  ctx.effect(() => {
    const dispose = ctx.get("webServer").register({
      kind: "prefix",
      path: BASE,
      handler: (request, response) => {
        void handler(request, response).catch((error) => {
          try {
            json(response, 500, {
              error: error instanceof Error ? error.message : String(error),
            });
          } catch {
            /* response already gone */
          }
        });
      },
    });
    return () => {
      dispose?.();
    };
  });
}
