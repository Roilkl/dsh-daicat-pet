/**
 * Client half of dsh-daicat-pet — draws 呆猫 in the Harness Web UI's shell overlay.
 *
 * Everything about the animation comes from the pet directory (served by the
 * host half), so changing the atlas or the timing needs no code change:
 *   anim.json   -> rows[]: { state, frames, durations[] }   (durations may repeat
 *                  the same frames several times; that is how "loop N times" works)
 *   spritesheet -> one row per state, one column per frame, cell = 192x208
 *   lines.json  -> optional ["台词 1", "台词 2", ...] used by click chatter
 *
 * Behaviour borrowed from dsh-whale-widget:
 *   - squash-and-stretch while pressed/dragged (body scaleY(.88) scaleX(1.05),
 *     bottom-centre origin, springy release),
 *   - the pet mirrors itself when it sits on the left half of the window,
 *   - click cycles pre-written lines in a speech bubble,
 *   - the token cost of each finished turn pops up in that bubble.
 */
window.__ModuleLoader__.load({
  id: "dsh-daicat-pet",
  factory(require) {
    var React = require("react");
    var h = React.createElement;

    var BASE = "/dsh-daicat-pet";
    var ATLAS_URL = BASE + "/atlas.webp";
    var TURN_URL = BASE + "/api/turn";
    var LINES_URL = BASE + "/api/lines";
    var KEY_POS = "dsh-daicat-pet:pos";
    var KEY_SIZE = "dsh-daicat-pet:size";
    var DEFAULT_SIZE = 192;
    var SQUISH = "scaleY(0.88) scaleX(1.05)";
    var REST = "scaleY(1) scaleX(1)";
    var TAP_VISUAL_MS = 32;
    var TURN_BUBBLE_MS = 6000;
    var LINE_BUBBLE_MS = 3600;

    var FALLBACK_LINES = [
      "喵？在写代码吗",
      "这一轮跑完啦",
      "摸一下我就不说话了",
      "记得喝水呀",
      "我先睡一会儿…",
      "别卷了，看看我",
    ];

    /* ------------------------------------------------------------------ styles */

    var STYLE_ID = "dsh-daicat-pet-style";
    var CSS = [
      ".dshdp-root{position:fixed;pointer-events:none;user-select:none;-webkit-user-select:none;",
      "font-family:inherit;z-index:2147483000;overflow:visible}",
      ".dshdp-body{position:absolute;left:0;top:0;width:100%;height:100%;",
      "transform-origin:50% 100%;transition:transform .22s cubic-bezier(.34,1.56,.64,1)}",
      ".dshdp-sprite{position:absolute;left:0;top:0;width:100%;height:100%;background-repeat:no-repeat;",
      "background-position:0 0;pointer-events:auto;cursor:grab;touch-action:none;",
      "will-change:background-position;filter:drop-shadow(0 6px 10px rgba(0,0,0,.18))}",
      ".dshdp-root.dshdp-dragging .dshdp-sprite{cursor:grabbing}",
      ".dshdp-root.dshdp-flip .dshdp-sprite{transform:scaleX(-1)}",
      ".dshdp-bubble{position:absolute;left:50%;translate:-50% 0;box-sizing:border-box;",
      "max-width:230px;min-width:64px;padding:7px 11px;border-radius:12px;",
      "background:rgba(255,255,255,.97);border:1px solid rgba(32,49,112,.18);",
      "box-shadow:0 6px 16px rgba(0,0,0,.16);color:#2c3550;font-size:12px;line-height:1.4;",
      "text-align:center;white-space:nowrap;pointer-events:none;z-index:2;",
      "opacity:0;transform:translateY(4px) scale(.94);transform-origin:50% 100%;",
      "transition:opacity .16s ease,transform .18s cubic-bezier(.34,1.4,.64,1)}",
      ".dshdp-bubble.dshdp-open{opacity:1;transform:translateY(0) scale(1)}",
      ".dshdp-bubble.dshdp-below{transform-origin:50% 0}",
      ".dshdp-bubble .dshdp-main{font-weight:600}",
      ".dshdp-bubble .dshdp-sub{margin-top:2px;font-size:11px;color:#8892ad;white-space:nowrap}",
    ].join("");

    function ensureStyle() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    }

    /* ------------------------------------------------------------------ data */

    var cache = null;
    var pending = null;

    function normalize(raw) {
      var cell = raw && raw.cell && typeof raw.cell === "object"
        ? { w: Number(raw.cell.w) || 192, h: Number(raw.cell.h) || 208 }
        : { w: 192, h: 208 };
      var rowsIn = Array.isArray(raw && raw.rows) ? raw.rows : [];
      var byState = new Map();
      var cols = 0;
      rowsIn.forEach(function (row, index) {
        var durations = Array.isArray(row.durations) && row.durations.length > 0
          ? row.durations.map(function (ms) { return Math.max(10, Number(ms) || 10); })
          : [150];
        var frames = Math.max(1, Number(row.frames) || durations.length);
        var total = durations.reduce(function (a, b) { return a + b; }, 0);
        var entry = {
          state: String(row.state || "idle"),
          row: index,
          frames: frames,
          durations: durations,
          total: total,
        };
        byState.set(entry.state, entry);
        if (frames > cols) cols = frames;
      });
      var sheet = raw && raw.sheet && typeof raw.sheet === "object" ? raw.sheet : {};
      return {
        cell: cell,
        byState: byState,
        order: rowsIn.map(function (row) { return String(row.state || "idle"); }),
        cols: Math.max(cols, Number(sheet.cols) || 0, 1),
        rowCount: Math.max(rowsIn.length, 1),
        stamp: String(Date.now()),
      };
    }

    function loadAnim() {
      if (cache !== null) return Promise.resolve(cache);
      if (pending === null) {
        pending = fetch(BASE + "/anim.json", { cache: "no-store" })
          .then(function (response) {
            if (!response.ok) throw new Error("anim.json: HTTP " + response.status);
            return response.json();
          })
          .then(function (raw) {
            cache = normalize(raw);
            return cache;
          })
          .catch(function (error) {
            pending = null;
            throw error;
          });
      }
      return pending;
    }

    var linesCache = null;

    function loadLines() {
      if (linesCache !== null) return Promise.resolve(linesCache);
      return fetch(LINES_URL, { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) return FALLBACK_LINES;
          return response.json();
        })
        .then(function (raw) {
          var list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.lines) ? raw.lines : [];
          list = list.filter(function (line) { return typeof line === "string" && line.trim() !== ""; });
          linesCache = list.length > 0 ? list : FALLBACK_LINES;
          return linesCache;
        })
        .catch(function () {
          linesCache = FALLBACK_LINES;
          return linesCache;
        });
    }

    /* --------------------------------------------------------------- formatting */

    function fmtTokens(value) {
      var n = Number(value) || 0;
      if (n < 1000) return String(n);
      if (n < 1e6) {
        var k = n / 1000;
        return (k >= 100 ? k.toFixed(0) : k >= 10 ? k.toFixed(1) : k.toFixed(2)) + "k";
      }
      return (n / 1e6).toFixed(2) + "M";
    }

    function turnLines(record) {
      var buckets = (record && record.buckets) || {};
      var parts = [];
      if (buckets.uncachedInputTokens > 0) parts.push("入 " + fmtTokens(buckets.uncachedInputTokens));
      if (buckets.outputTokens > 0) parts.push("出 " + fmtTokens(buckets.outputTokens));
      if (buckets.cacheReadTokens > 0) parts.push("缓存 " + fmtTokens(buckets.cacheReadTokens));
      if (buckets.cacheWriteTokens > 0) parts.push("写缓存 " + fmtTokens(buckets.cacheWriteTokens));
      return {
        main: "本轮 " + fmtTokens(record && record.totalTokens) + " tokens",
        sub: parts.join(" · "),
      };
    }

    /* --------------------------------------------------------------- posture */

    function service(ctx, key) {
      try {
        if (typeof ctx.get === "function") return ctx.get(key);
      } catch (error) {
        /* service unavailable */
      }
      return ctx[key];
    }

    function snapshotStore(store) {
      try {
        if (store && typeof store.getSnapshot === "function") return store.getSnapshot();
      } catch (error) {
        /* snapshot unavailable */
      }
      return null;
    }

    function mapLike(value) {
      if (value instanceof Map) return value;
      if (value && typeof value === "object" && value.byId) return value.byId;
      return null;
    }

    function computePose(ctx) {
      try {
        var sessions = service(ctx, "sessions");
        var list = snapshotStore(sessions && sessions.list);
        var uiSession = service(ctx, "uiSession");
        var status = mapLike(snapshotStore(uiSession && uiSession.sessionStatus));
        var byId = (list && list.byId) || null;
        var ids = [];
        if (list && Array.isArray(list.ids)) ids = list.ids.slice();
        else if (byId) ids = Object.keys(byId);
        if (status instanceof Map) {
          status.forEach(function (_value, id) {
            if (ids.indexOf(id) === -1) ids.push(id);
          });
        }
        var rows = [];
        for (var i = 0; i < ids.length; i += 1) {
          var id = ids[i];
          var row = (byId && byId[id]) || {};
          var live = (status instanceof Map ? status.get(id) : null) || {};
          var errorAt = Number(live.errorAt || live.updatedAt || 0);
          rows.push({
            id: String(id),
            running: Boolean(row.running || live.running),
            waiting: Boolean(live.pendingInteraction || row.pendingInteraction),
            failed: Boolean((live.error || row.error) && Date.now() - errorAt < 8000),
            review: Boolean(live.completionUnread) && !row.running,
          });
        }
        var hit =
          rows.find(function (r) { return r.waiting; }) ||
          rows.find(function (r) { return r.failed; }) ||
          rows.find(function (r) { return r.running; }) ||
          rows.find(function (r) { return r.review; });
        if (!hit) return "idle";
        if (hit.waiting) return "waiting";
        if (hit.failed) return "failed";
        if (hit.running) return "running";
        return "review";
      } catch (error) {
        return "idle";
      }
    }

    /* ----------------------------------------------------------------- state */

    function readNumber(key, fallback) {
      try {
        var raw = window.localStorage.getItem(key);
        var value = Number(raw);
        if (Number.isFinite(value) && value >= 48 && value <= 640) return value;
      } catch (error) {
        /* storage unavailable */
      }
      return fallback;
    }

    function readPos() {
      try {
        var raw = window.localStorage.getItem(KEY_POS);
        if (raw) {
          var value = JSON.parse(raw);
          if (Number.isFinite(value.x) && Number.isFinite(value.y)) return value;
        }
      } catch (error) {
        /* storage unavailable */
      }
      return null;
    }

    function clampPos(pos, width, height) {
      var maxX = Math.max(0, window.innerWidth - width);
      var maxY = Math.max(0, window.innerHeight - height);
      return {
        x: Math.min(Math.max(0, Math.round(pos.x)), maxX),
        y: Math.min(Math.max(0, Math.round(pos.y)), maxY),
      };
    }

    /* ------------------------------------------------------------- component */

    function PetOverlay(props) {
      var ctx = props.ctx;
      var modelState = React.useState(null);
      var model = modelState[0];
      var setModel = modelState[1];
      var sizeState = React.useState(readNumber(KEY_SIZE, DEFAULT_SIZE));
      var size = sizeState[0];
      var setSize = sizeState[1];
      var poseState = React.useState("idle");
      var pose = poseState[0];
      var setPose = poseState[1];
      var posState = React.useState(readPos);
      var pos = posState[0];
      var setPos = posState[1];
      var bubbleState = React.useState(null);
      var bubble = bubbleState[0];
      var setBubble = bubbleState[1];
      var flipState = React.useState(false);
      var flip = flipState[0];
      var setFlip = flipState[1];

      var rootRef = React.useRef(null);
      var bodyRef = React.useRef(null);
      var spriteRef = React.useRef(null);
      var poseRef = React.useRef(pose);
      var posRef = React.useRef(pos);
      var transientRef = React.useRef(null);
      var dragRef = React.useRef(null);
      var pressRef = React.useRef(0);
      var animRef = React.useRef({ frame: 0, acc: 0, last: 0, pose: pose });
      var bubbleTimer = React.useRef(0);
      var turnSeqRef = React.useRef(0);
      var lineIndexRef = React.useRef(0);
      var linesRef = React.useRef(FALLBACK_LINES);

      var ratio = model ? model.cell.h / model.cell.w : 208 / 192;
      var width = Math.round(size);
      var height = Math.round(size * ratio);

      React.useEffect(function () {
        ensureStyle();
      }, []);

      React.useEffect(function () {
        var alive = true;
        loadAnim()
          .then(function (value) {
            if (!alive) return;
            setModel(value);
            mark("ready");
          })
          .catch(function (error) {
            if (alive) mark("error:" + (error && error.message ? error.message : error));
            console.warn("[dsh-daicat-pet] 图集加载失败", error);
          });
        loadLines().then(function (list) {
          if (alive) linesRef.current = list;
        });
        return function () {
          alive = false;
        };
      }, []);

      React.useEffect(function () {
        posRef.current = pos;
      }, [pos]);

      React.useEffect(function () {
        if (poseRef.current !== pose) {
          poseRef.current = pose;
          animRef.current.frame = 0;
          animRef.current.acc = 0;
        }
      }, [pose]);

      /* greet once when the atlas is ready */
      React.useEffect(function () {
        if (!model) return;
        play("waving");
        return function () {
          transientRef.current = null;
        };
      }, [model]);

      /* pose + turn-cost polling */
      React.useEffect(function () {
        var alive = true;
        function tick() {
          if (!alive) return;
          if (transientRef.current === null || Date.now() >= transientRef.current.until) {
            if (transientRef.current !== null) transientRef.current = null;
            setPose(computePose(ctx));
          }
          fetch(TURN_URL, { cache: "no-store" })
            .then(function (response) {
              return response.ok ? response.json() : null;
            })
            .then(function (record) {
              if (!alive || !record || typeof record.seq !== "number") return;
              if (record.seq <= turnSeqRef.current) return;
              turnSeqRef.current = record.seq;
              if (!record.totalTokens) return;
              var lines = turnLines(record);
              showBubble(lines.main, lines.sub, TURN_BUBBLE_MS);
              // a finished turn deserves a little wiggle: review pose when the
              // atlas has it, otherwise the usual wave.
              play("review");
            })
            .catch(function () {
              /* keep the pet alive when the host is busy */
            });
        }
        var timer = window.setInterval(tick, 700);
        tick();
        return function () {
          alive = false;
          window.clearInterval(timer);
        };
      }, [ctx]);

      /* responses to window resizes keep the pet inside the viewport */
      React.useEffect(function () {
        function onResize() {
          setPos(function (current) {
            if (!current) return current;
            return clampPos(current, width, height);
          });
          refreshFlip();
        }
        window.addEventListener("resize", onResize);
        return function () {
          window.removeEventListener("resize", onResize);
        };
      }, [width, height]);

      /* the animation clock */
      React.useEffect(function () {
        if (!model) return undefined;
        var raf = 0;
        function step(now) {
          var node = spriteRef.current;
          var clock = animRef.current;
          if (node) {
            if (clock.last === 0) clock.last = now;
            var dt = now - clock.last;
            clock.last = now;
            if (dt > 250) dt = 250;
            var row = model.byState.get(clock.pose) || model.byState.get("idle");
            if (!row) {
              var first = model.order.length > 0 ? model.byState.get(model.order[0]) : null;
              row = first || null;
            }
            if (row) {
              clock.acc += dt;
              var guard = 0;
              while (clock.acc >= row.durations[clock.frame] && guard < 4096) {
                clock.acc -= row.durations[clock.frame];
                clock.frame = (clock.frame + 1) % row.durations.length;
                guard += 1;
              }
              var col = clock.frame % row.frames;
              node.style.backgroundPosition =
                (-col * width + "px ") + (-row.row * height + "px");
              node.dataset.daicatPose = clock.pose;
              node.dataset.daicatFrame = String(clock.frame);
              node.dataset.daicatCell = row.row + ":" + col;
            }
          }
          raf = window.requestAnimationFrame(step);
        }
        raf = window.requestAnimationFrame(step);
        return function () {
          window.cancelAnimationFrame(raf);
        };
      }, [model, width, height]);

      /* follow the live pose without restarting the clock effect */
      React.useEffect(function () {
        animRef.current.pose = pose;
      }, [pose]);

      function mark(state) {
        try {
          document.documentElement.setAttribute("data-dsh-daicat-pet", state);
        } catch (error) {
          /* document unavailable */
        }
      }

      function showBubble(main, sub, ms) {
        setBubble({ main: main, sub: sub || "" });
        if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
        bubbleTimer.current = window.setTimeout(function () {
          bubbleTimer.current = 0;
          setBubble(null);
        }, ms);
      }

      function play(name) {
        var row = model && model.byState.get(name);
        if (!row) return;
        transientRef.current = { pose: name, until: Date.now() + row.total };
        setPose(name);
        window.setTimeout(function () {
          var current = transientRef.current;
          if (current === null || Date.now() + 4 < current.until) return;
          transientRef.current = null;
          setPose(computePose(ctx));
        }, row.total + 20);
      }

      function centerX(x) {
        return x + width / 2;
      }

      function refreshFlipAt(x) {
        var next = centerX(typeof x === "number" ? x : where0().x) < window.innerWidth / 2;
        setFlip(function (current) { return current === next ? current : next; });
      }

      function where0() {
        var fallback = {
          x: Math.max(0, window.innerWidth - width - 24),
          y: Math.max(0, window.innerHeight - height - 16),
        };
        return clampPos(posRef.current || fallback, width, height);
      }

      function refreshFlip() {
        refreshFlipAt(where0().x);
      }

      function squash(on) {
        var node = bodyRef.current;
        if (!node) return;
        node.style.transform = on ? SQUISH : REST;
      }

      function onPointerDown(event) {
        if (event.button !== 0) return;
        var base = where0();
        dragRef.current = {
          dx: event.clientX - base.x,
          dy: event.clientY - base.y,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          pointerId: event.pointerId,
        };
        pressRef.current = window.performance ? window.performance.now() : Date.now();
        squash(true);
        try {
          rootRef.current.classList.add("dshdp-dragging");
        } catch (error) {
          /* class list unavailable */
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch (error) {
          /* capture unavailable */
        }
        event.preventDefault();
      }

      function onPointerMove(event) {
        var drag = dragRef.current;
        if (!drag) return;
        // A pointer jitter under a few pixels is still a click, not a drag.
        if (!drag.moved) {
          var dxs = event.clientX - drag.startX;
          var dys = event.clientY - drag.startY;
          if (dxs * dxs + dys * dys > 9) drag.moved = true;
        }
        var next = clampPos({ x: event.clientX - drag.dx, y: event.clientY - drag.dy }, width, height);
        posRef.current = next; // keep the ref ahead of React so the drop position is exact
        setPos(next);
        refreshFlipAt(next.x);
      }

      function onPointerUp(event) {
        var drag = dragRef.current;
        dragRef.current = null;
        var now = window.performance ? window.performance.now() : Date.now();
        if (now - pressRef.current < TAP_VISUAL_MS) {
          // A very fast tap lands inside one frame; keep the squash visible for
          // one beat before releasing, the way a real press would.
          var node = bodyRef.current;
          if (node) {
            var previous = node.style.transition;
            node.style.transition = "none";
            node.style.transform = SQUISH;
            void node.offsetWidth;
            node.style.transition = previous;
          }
        }
        squash(false);
        try {
          rootRef.current.classList.remove("dshdp-dragging");
        } catch (error) {
          /* class list unavailable */
        }
        if (!drag) return;
        try {
          event.currentTarget.releasePointerCapture(drag.pointerId);
        } catch (error) {
          /* capture unavailable */
        }
        if (drag.moved) {
          try {
            window.localStorage.setItem(KEY_POS, JSON.stringify(posRef.current));
          } catch (error) {
            /* storage unavailable */
          }
          return;
        }
        // plain click: cycle the pre-written lines
        var lines = linesRef.current.length > 0 ? linesRef.current : FALLBACK_LINES;
        var line = lines[lineIndexRef.current % lines.length];
        lineIndexRef.current += 1;
        showBubble(line, "", LINE_BUBBLE_MS);
        play(pose === "waiting" ? "jumping" : "waving");
      }

      function onWheel(event) {
        if (!event.ctrlKey) return;
        event.preventDefault();
        var next = Math.round(Math.min(640, Math.max(48, size + (event.deltaY < 0 ? 8 : -8))));
        setSize(next);
        try {
          window.localStorage.setItem(KEY_SIZE, String(next));
        } catch (error) {
          /* storage unavailable */
        }
      }

      var where = where0();
      var bubbleAbove = where.y > 96;
      var bubbleStyle = {
        bottom: bubbleAbove ? height + 6 + "px" : "",
        top: bubbleAbove ? "" : height + 6 + "px",
      };

      return h("div", {
        ref: rootRef,
        className: "dshdp-root" + (flip ? " dshdp-flip" : ""),
        "data-dsh-daicat-pet-root": "",
        style: {
          left: where.x + "px",
          top: where.y + "px",
          width: width + "px",
          height: height + "px",
        },
      }, [
        h("div", {
          key: "body",
          ref: bodyRef,
          className: "dshdp-body",
          style: { transform: REST },
        }, h("div", {
          key: "sprite",
          ref: spriteRef,
          className: "dshdp-sprite",
          title: "呆猫 · 拖动我，点一下说话",
          role: "img",
          "aria-label": "呆猫桌宠",
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onPointerCancel: onPointerUp,
          onWheel: onWheel,
          style: {
            backgroundImage: model ? "url(" + ATLAS_URL + "?v=" + model.stamp + ")" : "none",
            backgroundSize: model ? width * model.cols + "px " + height * model.rowCount + "px" : "auto",
            opacity: model ? 1 : 0,
            transition: "opacity 240ms ease",
          },
        })),
        h("div", {
          key: "bubble",
          className: "dshdp-bubble" + (bubble ? " dshdp-open" : "") + (bubbleAbove ? "" : " dshdp-below"),
          style: bubbleStyle,
          "aria-live": "polite",
        }, [
          h("div", { key: "main", className: "dshdp-main" }, bubble ? bubble.main : ""),
          bubble && bubble.sub
            ? h("div", { key: "sub", className: "dshdp-sub" }, bubble.sub)
            : null,
        ].filter(Boolean)),
      ]);
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("shell.overlay", function () {
          return ctx.slots.register(
            { name: "shell.overlay", id: "daicat-pet", order: 40 },
            function () {
              return h(PetOverlay, { ctx: ctx });
            },
          );
        });
      },
    };
  },
});
