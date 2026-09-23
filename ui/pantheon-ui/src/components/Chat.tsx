// Chat — ACP-чат: автостарт goose serve + welcome-экран; субагенты — иерархия внутри сессии
import React, { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from "react";
import {
  AcpSession, ChatMessage, TodoItem, SubagentRow, listSubagents, errText,
  Attachment, dataUrlToImage, compressImageDataUrl, isTauri, safeInvoke,
} from "../acp";
import { getCatalog, getConfigLimits } from "../api";
import { renderMarkdown, renderUserText } from "../markdown";
import { renderToolBody } from "../toolRender";
import PantheonRoleBadge from "./PantheonRoleBadge";
import { Icon } from "./Icon";
import { useDragWidth } from "../useDragWidth";
import UsageBar from "./UsageBar";

/** Копирование текста в буфер: clipboard API с fallback на execCommand (WebKitGTK) */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 18) return "Добрый день";
  if (h >= 18 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hero-clock">
      <div className="hero-time">
        {now.getHours().toString().padStart(2, "0")}:{now.getMinutes().toString().padStart(2, "0")}
      </div>
      <div className="hero-greeting">{greeting()}</div>
    </div>
  );
}

export function ChatPage(props: { railWidth: number; onRailWidth: (w: number) => void }) {
  const startRailResize = useDragWidth(() => props.railWidth, props.onRailWidth, {
    min: 210, max: 480, invert: true,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [ctx, setCtx] = useState<{ tokens: number; limit: number | null; threshold: number | null }>({ tokens: 0, limit: null, threshold: null });
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [subagents, setSubagents] = useState<SubagentRow[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<AcpSession | null>(null);
  const startedRef = useRef(false);

  // автоскролл
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [messages.length]);

  const makeSession = () =>
    new AcpSession({
      onMessage: (m) =>
        setMessages((ms) => {
          const last = ms[ms.length - 1];
          // Стрим: каждый chunk — не новое сообщение, а продолжение предыдущего
          // (пока не было tool/user — они разрывают цепочку)
          if ((m.role === "agent" || m.role === "thinking") && last?.role === m.role && last.chunk) {
            return [...ms.slice(0, -1), { ...last, text: last.text + m.text }];
          }
          const msg: ChatMessage =
            m.role === "agent" || m.role === "thinking" ? { ...m, chunk: true } : m;
          return [...ms.slice(-400), msg];
        }),
      onUpdateMessage: (id, patch) =>
        setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m))),
      onTodo: (items) => setTodos(items.length ? items : null),
      onReady: () => setStatus("ready"),
      onError: (e) => { setError(e); setStatus("error"); },
    });

  const connect = async () => {
    // retry: сначала убить прошлый sidecar/сессию, иначе зомби goose serve
    sessionRef.current?.stop();
    setError("");
    setStatus("starting");
    const s = makeSession();
    sessionRef.current = s;
    try { await s.start(); } catch (e) { setError(errText(e).slice(0, 200)); setStatus("error"); }
  };

  // автоподключение: стартовый экран сразу готов к вводу, без ручной кнопки
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    connect();
    return () => sessionRef.current?.stop();
  }, []);

  // лимиты контекста + порог автосжатия (один раз)
  useEffect(() => {
    const load = async () => {
      try {
        const cat = await getCatalog();
        const models = cat.modelsByProvider?.["opencode_go"] ?? [];
        const m = models.find((x) => x.name === "glm-5.3-flash") ?? models[0];
        const cfg = await getConfigLimits().catch(() => null);
        setCtx((c) => ({ ...c, limit: m?.context_limit ?? null, threshold: cfg?.goose_auto_compact_threshold ?? null }));
      } catch { /* демо-режим */ }
    };
    void load();
  }, []);

  // токены текущей сессии: poll вместе с субагентами
  useEffect(() => {
    if (!sessionRef.current?.id) { setCtx((c) => ({ ...c, tokens: 0 })); return; }
    const sid = sessionRef.current.id;
    const poll = async () => {
      try {
        const rows = await safeInvoke<{ id: string; total_tokens?: number }[]>("list_sessions", { onlyRunning: false });
        const row = rows?.find((r) => r.id === sid);
        if (row) setCtx((c) => ({ ...c, tokens: row.total_tokens ?? 0 }));
      } catch { /* тихо */ }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [messages.length, status === "ready"]);

  const compact = async () => {
    if (!sessionRef.current || status !== "ready") return;
    setStreaming(true);
    try { await sessionRef.current.prompt("/compact"); }
    catch (e) { setError(`Сжатие: ${errText(e).slice(0, 120)}`); }
    finally { setStreaming(false); }
  };

  // открыть старый чат из Истории: App шлёт "load-session" (подробности — чтобы
  // не ловить собственный dispatch, App слушает другое имя "open-session")
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      if (!id) return;
      void connectToRef.current(id);
    };
    window.addEventListener("load-session", onOpen as EventListener);
    // remount-случай: pending может быть ещё не вычитан
    const pending = (window as any).__pantheon_pending_session as string | undefined;
    if (pending) {
      delete (window as any).__pantheon_pending_session;
      void connectToRef.current(pending);
    }
    return () => window.removeEventListener("load-session", onOpen as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectToRef = useRef<(id: string) => Promise<void>>(async () => {});
  const connectTo = async (sessionId: string) => {
    sessionRef.current?.stop();
    setMessages([]);
    setTodos(null);
    setAttachments([]);
    setSubagents([]);
    setError("");
    setStatus("starting");
    const s = makeSession();
    sessionRef.current = s;
    try { await s.load(sessionId); }
    catch (e) { setError(`Не удалось открыть сессию: ${errText(e).slice(0, 160)}`); setStatus("error"); }
    // статус ready выставится в onReady после replay
  };
  connectToRef.current = connectTo;

  // иерархия: субагенты ТОЛЬКО текущей сессии (children), не глобальный список
  useEffect(() => {
    const parent = sessionRef.current?.id;
    if (!parent) { setSubagents([]); return; }
    const load = () => listSubagents(parent).then(setSubagents).catch(() => setSubagents([]));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [status === "ready", messages.length]);

  // ── вложения: Ctrl+V / drop / file input ──────────────────────────
  const addImageFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const next: Attachment[] = [];
    for (const f of imgs) {
      const id = crypto.randomUUID();
      try {
        const raw = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.onerror = () => rej(r.error);
          r.readAsDataURL(f);
        });
        const dataUrl = await compressImageDataUrl(raw);
        const img = dataUrlToImage(dataUrl);
        if (!img) continue;
        // staging оригинала: субагенты (delegate) не получают image-блоки,
        // но умеют read_image — путь в тексте решает задачу
        let path: string | undefined;
        try {
          if (isTauri()) {
            const bytes = new Uint8Array(await f.arrayBuffer());
            path = await safeInvoke<string>("stage_attachment", {
              name: f.name || "attachment.png",
              data: Array.from(bytes),
            });
          }
        } catch { /* без пути картинки — только ACP block */ }
        next.push({
          id, name: f.name || "screenshot.png", kind: "image" as const,
          dataUrl, data: img.data, mimeType: img.mimeType, path,
        });
      } catch {
        next.push({ id, name: f.name || "image", kind: "image" as const, error: "не удалось прочитать" });
      }
    }
    if (next.length) setAttachments((a) => [...a, ...next].slice(0, 8));
  };

  const stageFile = async (f: File) => {
    const id = crypto.randomUUID();
    const name = f.name || "attachment";
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (!isTauri()) {
        setAttachments((a) => [...a, { id, name, kind: "file" as const, error: "нет Tauri IPC" }].slice(0, 8));
        return;
      }
      const path = await safeInvoke<string>("stage_attachment", {
        name,
        data: Array.from(bytes),
      });
      setAttachments((a) => [...a, { id, name, kind: "file" as const, path }].slice(0, 8));
    } catch (e) {
      setAttachments((a) => [...a, {
        id, name, kind: "file" as const, error: errText(e).slice(0, 80),
      }].slice(0, 8));
    }
  };

  const ingestFiles = async (files: File[] | FileList | null | undefined) => {
    if (!files) return;
    const arr = Array.from(files);
    if (!arr.length) return;
    await addImageFiles(arr);
    for (const f of arr) {
      if (!f.type.startsWith("image/")) await stageFile(f);
    }
  };
  // стабильная ссылка для document-level listeners (иначе эффект пересоздаётся каждый render)
  const ingestRef = useRef(ingestFiles);
  ingestRef.current = ingestFiles;

  // timestamp последнего инжеста из paste-события (защита от дублей keydown+paste)
  const pasteHandledRef = useRef(0);
  /** Нативное чтение буфера (wl-paste): главный путь Ctrl+V на WebKitGTK */
  const tryNativeClipboard = async () => {
    if (!isTauri()) return;
    try {
      const ci = await safeInvoke<{ mime: string; data: number[] } | null>("clipboard_image");
      if (ci && ci.data?.length) {
        const ext = ci.mime.split("/")[1] || "png";
        const file = new File([new Uint8Array(ci.data)], `clipboard.${ext}`, { type: ci.mime });
        // ключ = размер+дериватив: не задваивать, если paste-event уже отдал файл
        if (pasteHandledRef.current < Date.now() - 800) {
          pasteHandledRef.current = Date.now();
          await ingestRef.current([file]);
        }
      }
    } catch { /* wl-clipboard нет / не image */ }
  };

  const tryNativeRef = useRef(tryNativeClipboard);
  tryNativeRef.current = tryNativeClipboard;

  /** Нативный Tauri drop: путь → chip (документ) или bytes → image (картинка) */
  const fetchFileFromPath = async (path: string) => {
    const name = path.split("/").pop() || "file";
    const isImg = /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(path);
    if (!isImg) {
      setAttachments((a) => [...a, {
        id: crypto.randomUUID(), name, kind: "file" as const, path,
      }].slice(0, 8));
      return;
    }
    try {
      const bytes = await safeInvoke<number[]>("read_file_bytes", { path });
      const ext = name.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      const file = new File([new Uint8Array(bytes)], name, { type: mime });
      await ingestRef.current([file]);
    } catch {
      setAttachments((a) => [...a, {
        id: crypto.randomUUID(), name, kind: "file" as const, path,
      }].slice(0, 8));
    }
  };

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      e.preventDefault();
      void ingestFiles(files);
      return;
    }
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgItems = items.filter((it) => it.type.startsWith("image/"));
    if (imgItems.length) {
      e.preventDefault();
      const fs = imgItems.map((it) => it.getAsFile()).filter((f): f is File => !!f);
      void ingestFiles(fs);
    }
  };

  const onDropZone = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    void ingestFiles(e.dataTransfer.files);
  };

  const removeAttachment = (id: string) =>
    setAttachments((a) => a.filter((x) => x.id !== id));

  const send = async () => {
    const text = input.trim();
    const ready = attachments.filter((a) => !a.error && (a.kind === "image" ? a.data : a.path));
    if ((!text && !ready.length) || !sessionRef.current || status !== "ready") return;
    setInput("");
    const images = ready
      .filter((a) => a.kind === "image" && a.data && a.mimeType)
      .map((a) => ({ data: a.data!, mimeType: a.mimeType! }));
    // файлы-документы И staged-картинки: путь в тексте (субагенты читают файлы)
    const paths = ready.filter((a) => a.path).map((a) => a.path!);
    setAttachments([]);
    setStreaming(true);
    try { await sessionRef.current.prompt(text, images, paths); }
    catch (e) { setError(`Ошибка промпта: ${errText(e).slice(0, 200)}`); }
    finally { setStreaming(false); }
  };

  // глобальный paste/drop: не надо фокусить textarea; DnD — нативный Tauri (WebKitGTK HTML5-DnD ненадёжен)
  useEffect(() => {
    let alive = true;
    let unlistenNative: (() => void) | null = null;

    const onDocPaste = (ev: ClipboardEvent) => {
      // текст оставляем textarea/native — ловим только файлы/картинки
      const files = Array.from(ev.clipboardData?.files ?? []);
      const hasImg = Array.from(ev.clipboardData?.items ?? [])
        .some((it) => it.kind === "file" || it.type.startsWith("image/"));
      if (!files.length && !hasImg) return;
      // если caret в textarea и это чисто текстовый paste — не перехватываем
      const ae = document.activeElement;
      if (ae && ae.tagName === "TEXTAREA" && !files.length) {
        const items = Array.from(ev.clipboardData?.items ?? []);
        if (!items.some((it) => it.type.startsWith("image/"))) return;
      }
      ev.preventDefault();
      pasteHandledRef.current = Date.now();
      if (files.length) {
        void ingestRef.current(files);
        return;
      }
      const fs = Array.from(ev.clipboardData?.items ?? [])
        .filter((it) => it.type.startsWith("image/") || it.kind === "file")
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      void ingestRef.current(fs);
      // fallback: WebKitGTK отдаёт image paste мёртвым ClipboardEvent — читаем нативно (wl-clipboard)
      if (!files.length && !fs.length) {
        void (async () => {
          try {
            const ci = await safeInvoke<{ mime: string; data: number[] } | null>("clipboard_image");
            if (ci && ci.data?.length) {
              const ext = ci.mime.split("/")[1] || "png";
              const file = new File([new Uint8Array(ci.data)], `clipboard.${ext}`, { type: ci.mime });
              await ingestRef.current([file]);
            }
          } catch { /* wl-clipboard нет / не image — молчим */ }
        })();
      }
    };

    // paste на document: Ctrl+V работает без фокуса на textarea
    document.addEventListener("paste", onDocPaste as EventListener);

    // keydown-путь: Ctrl+V → нативный wl-paste напрямую (WebKitGTK paste event с image ненадёжен)
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === "v" && !ev.altKey) {
        // paste event наступит следом; если он отдаст файл — pasteHandledRef отсечёт дубль
        const t0 = Date.now();
        setTimeout(() => {
          if (pasteHandledRef.current < t0) void tryNativeRef.current();
        }, 120);
      }
    };
    document.addEventListener("keydown", onKey, true);

    // страховка против нативного «открыть файл в окне»
    const onWindowDrop = (ev: globalThis.DragEvent) => {
      if (ev.dataTransfer?.types?.includes("Files")) ev.preventDefault();
    };
    const onWindowDragOver = (ev: globalThis.DragEvent) => {
      if (ev.dataTransfer?.types?.includes("Files")) {
        ev.preventDefault();
        document.querySelector(".chat-page")?.classList.add("drop-active");
      }
    };
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);

    // нативный Tauri DnD — основной путь в WebKitGTK
    (async () => {
      if (!isTauri()) return;
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        unlistenNative = await getCurrentWebview().onDragDropEvent((event) => {
          if (!alive) return;
          const page = document.querySelector(".chat-page");
          // EventCallback<TauriEvent> → { event, payload }
          const payload = (event as unknown as { payload?: { type?: string; paths?: string[] } }).payload
            ?? (event as unknown as { type?: string; paths?: string[] });
          const type = payload.type;
          if (type === "enter" || type === "over") {
            page?.classList.add("drop-active");
          } else if (type === "leave") {
            page?.classList.remove("drop-active");
          } else if (type === "drop") {
            page?.classList.remove("drop-active");
            const paths = payload.paths ?? [];
            for (const path of paths) void fetchFileFromPath(path);
          }
        });
      } catch { /* не Tauri / нет webview API */ }
    })();

    return () => {
      alive = false;
      document.removeEventListener("paste", onDocPaste as EventListener);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
      unlistenNative?.();
      document.querySelector(".chat-page")?.classList.remove("drop-active");
    };
  }, []);

  // стабильные ссылки — иначе MessageList перерендеривается на каждый keystroke
  const onSubagent = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent("open-subagent", { detail: id }));
  }, []);
  const onCancel = useCallback(() => { sessionRef.current?.cancel(); }, []);

  const running = subagents.filter((s) => s.running).length;
  const hasConversation = messages.length > 0;

  return (
    <div className="chat-page">
      <div className="chat-col">
        <header className="topbar">
          <PantheonRoleBadge role="goose" model="opencode_go/glm-5.3-flash" cost="MEDIUM" />
          <span className={`chat-state ${status}`}>{statusLabel(status)}{streaming && " · ответ…"}</span>
          {hasConversation && (
            <span className="ctx-meter" title="Использование контекстного окна текущей сессии">
              <span className="ctx-tokens">{fmtTokens(ctx.tokens)} ткн</span>
              {ctx.limit ? <><span className="dim">/</span> <span>{fmtTokens(ctx.limit)}</span></> : null}
              {ctx.threshold != null ? <span className="dim small">· автосжатие {Math.round(ctx.threshold * 100)}%</span> : null}
              <button
                type="button"
                className="ctx-compact-btn"
                disabled={status !== "ready" || streaming}
                title="Ручное сжатие: отправить /compact (goose сжимает историю)"
                onClick={() => void compact()}
              >Сжать</button>
            </span>
          )}
        </header>
        <div className="chat-scroll" ref={scrollerRef}>
          {hasConversation === false && (
            <div className="chat-center">
              <div className="chat-hero">
                <Clock />
                {status === "error" && (
                  <div className="error-banner">
                    ⚠ {error}{" "}
                    <button className="primary" onClick={connect}>повторить подключение</button>
                  </div>
                )}
                {status !== "ready" && status !== "error" && (
                  <div className="dim small">подключение к goose serve…</div>
                )}
              </div>
            </div>
          )}
          {error && hasConversation && <div className="error-banner">⚠ {error}</div>}
          <MessageList messages={messages} streaming={streaming} onSubagent={onSubagent} onCancel={onCancel} />
        </div>
        <div
          className="chat-input-zone"
          data-drop-zone="true"
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
          }}
          onDrop={onDropZone}
        >
          {attachments.length > 0 && (
            <div className="attach-chips">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className={`attach-chip${a.error ? " err" : ""}`}
                  title={a.error || a.path || a.name}
                >
                  {a.kind === "image" && a.dataUrl
                    ? <img src={a.dataUrl} alt="" />
                    : <span className="attach-file-icon">📄</span>}
                  <span className="attach-name">{a.name}</span>
                  <button type="button" className="attach-x" onClick={() => removeAttachment(a.id)} aria-label="Убрать">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <button
              type="button"
              className="attach-btn"
              title="Прикрепить файл"
              disabled={status !== "ready"}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="clipboard" size={15} />
            </button>
            <textarea
              className="chat-input"
              placeholder="Сообщение… (Enter — отправить, Ctrl+V — вставить фото/файл)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              disabled={status !== "ready"}
            />
            <button
              className="primary"
              disabled={status !== "ready" || (!input.trim() && attachments.length === 0)}
              onClick={send}
            >→</button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void ingestFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <UsageBar refreshKey={messages.length} />
      </div>

      <aside
        className="chat-right"
        style={{ display: hasConversation ? undefined : "none", width: props.railWidth, minWidth: props.railWidth }}
      >
        <div className="resize-handle" onMouseDown={startRailResize} title="Потянуть — изменить ширину" />
        {todos && (
          <section className="rail-card">
            <h3><Icon name="clipboard" /> Задачи</h3>
            <ul className="todo-list">
              {todos.map((t, i) => {
                const [title, detail] = t.content.split(" — ");
                return (
                  <li key={i} className={`todo-${t.status}`}>
                    <span className="todo-box">{t.status === "completed" ? "✓" : t.status === "in_progress" ? "·" : ""}</span>
                    <span className="todo-text">
                      {title}
                      {detail && <span className="todo-detail">{detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {subagents.length > 0 && (
          <section className="rail-card">
            <h3><Icon name="puzzle" /> Субагенты{running ? ` · ${running} активн.` : ""}</h3>
            <ul className="subagent-list">
              {subagents.map((s) => (
                <li key={s.id}>
                  <span className={`chat-dot${s.running ? " on" : ""}`} />
                  <button className="subagent-name" onClick={() => window.dispatchEvent(new CustomEvent("open-subagent", { detail: s.id }))}>
                    {s.label}
                  </button>
                  <span className="dim small">{s.tokens.toLocaleString("ru")} ткн</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function fmtTokens(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return String(n);
}

function statusLabel(s: string) {
  return { idle: "не подключено", starting: "подключение…", ready: "готов · glm-5.3-flash", error: "ошибка" }[s] ?? s;
}

/** Свёрнутое/раскрытое тело: по умолчанию клип, кнопка — полная высота со скроллом */
function ExpandableBody(props: {
  html: string;
  className?: string;
  collapsed?: number;
  label?: string;
}) {
  const { html, className = "", collapsed = 110, label = "Раскрыть полностью" } = props;
  const [open, setOpen] = useState(false);
  return (
    <div className={`xbody ${open ? "open" : ""} ${className}`}>
      <div
        className="xbody-inner"
        style={open ? undefined : { maxHeight: collapsed }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button
        type="button"
        className="xbody-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "▲ Свернуть" : `▼ ${label}`}
      </button>
    </div>
  );
}

/** Thinking в основном чате: свёрнуто, кнопка → полный текст со скроллом */
function ThinkingBlock(props: { text: string }) {
  const html = useMemo(() => renderMarkdown(props.text), [props.text]);
  return (
    <div className="msg msg-thinking">
      <div className="think-label">💭 Рассуждения</div>
      <ExpandableBody html={html} className="think-body" collapsed={64} label="Показать цепочку мышления" />
    </div>
  );
}

/** Отдельное сообщение — мемоизировано, markdown кэшируется по text */
const MessageItem = React.memo(function MessageItem(props: {
  m: ChatMessage;
  onSubagent: (id: string) => void;
}) {
  const { m, onSubagent } = props;
  const [copied, setCopied] = useState(false);

  // кэш markdown/html — пересчитываем ТОЛЬКО при смене text/role
  const html = useMemo(() => {
    if (m.role === "tool") return renderToolBody(m.toolName ?? "", m.toolInput ?? m.text ?? "");
    if (m.role === "thinking") return renderMarkdown(m.text ?? "");
    return m.role === "user" ? renderUserText(m.text ?? "") : renderMarkdown(m.text ?? "");
  }, [m.text, m.role, m.toolName, m.toolInput]);

  const copy = useCallback(() => {
    const src = m.role === "tool" ? (m.toolInput ?? m.text ?? "") : (m.text ?? "");
    copyText(src);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [m.text, m.toolInput, m.role]);

  if (m.role === "thinking") {
    return <ThinkingBlock text={m.text ?? ""} />;
  }

  if (m.role === "tool") {
    return (
      <div className={`msg msg-tool`}>
        <div className={`tool-call tool-${m.toolStatus ?? "completed"}`}>
          <span className="tool-icon"><Icon name="app" size={13} /></span>
          <span className="tool-name">{m.toolName}</span>
          {m.subagentSessionId && (
            <button className="tool-subagent" onClick={() => onSubagent(m.subagentSessionId!)}>
              ↗ субагент
            </button>
          )}
          <button className="msg-copy" onClick={copy} title="Копировать">{copied ? "✓" : "⧉"}</button>
          <ExpandableBody html={html} className="tool-body" collapsed={96} label="Раскрыть вызов" />
        </div>
      </div>
    );
  }

  return (
    <div className={`msg msg-${m.role}`}>
      <button className="msg-copy" onClick={copy} title="Копировать сообщение">{copied ? "✓" : "⧉"}</button>
      <div
        className={`bubble ${m.role === "user" ? "user-text" : "md-body"}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

function MessageList(props: { messages: ChatMessage[]; streaming: boolean; onSubagent: (id: string) => void; onCancel: () => void }) {
  return (
    <>
      {props.messages.map((m, i) => (
        <MessageItem key={m.id + i} m={m} onSubagent={props.onSubagent} />
      ))}
      {props.streaming && (
        <div className={`msg msg-agent streaming`}>
          <div className="bubble"><span className="dots"><i /><i /><i /></span></div>
        </div>
      )}
      {props.streaming && (
        <button className="cancel-btn" onClick={props.onCancel}>⏹ Прервать</button>
      )}
    </>
  );
}

export default ChatPage;
