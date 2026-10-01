/**
 * Interview.tsx — interactive survey for pantheon_interview tool calls.
 * Layout follows the OpenCode Desktop interview screens, Mayak accent styling
 * (magenta/violet, Wave theme tokens) instead of the OpenCode blue.
 *
 * Two render targets:
 *  - <InterviewCard> — compact feed entry shown INSTEAD of the plain tool-call
 *    chip (Chat.tsx MessageItem);
 *  - <Interview>     — modal overlay. ChatPage mounts it as the LAST child of
 *    the chat column: GPUIX has no z-index, paint order = child order, so the
 *    last sibling draws above feed/input.
 *
 * GPUIX constraints honored: one scroll parent (the modal never scrolls
 * internally — one question per screen keeps it within the viewport), <text>
 * always has an explicit color, every style object with flex keys carries
 * display:"flex", padding is numbers only, no letterSpacing.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { InterviewQuestion, InterviewSpec } from "../acp";
import { fs, type WaveTheme } from "../tokens";
import { log } from "../logger";
import { Icon } from "./Icon";

/**
 * Window-level keydown bridge: app.tsx routes root keys through winKeys.chat
 * (a single slot already taken by Chat's Ctrl+V), so the open interview lends
 * its "advance" handler through this module ref. Chat.tsx calls next() on Ctrl+→.
 */
export const interviewKeys: { next: (() => void) | null } = { next: null };

/** Per-question selection state: picked option labels + free-text custom answer. */
export interface InterviewAnswer {
  labels: string[];
  custom: string;
  /** true when the custom row is the active choice (typing activates it) */
  customActive: boolean;
}

const emptyAnswer = (): InterviewAnswer => ({ labels: [], custom: "", customActive: false });

/** Proper Russian plural for the question counter (singular / paucal / plural). */
export function questionsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "вопрос";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "вопроса";
  return "вопросов";
}

/**
 * Build the answers payload sent to the agent as a user message — exact contract:
 *   [Интервью: <title>]
 *   1. <question> → <labels joined with ", ">[; свой: <custom>]
 *   2. …
 */
export function buildInterviewAnswers(
  spec: InterviewSpec,
  answers: Record<number, InterviewAnswer>,
): string {
  const title = (spec.title ?? "").trim() || "Опрос";
  const lines: string[] = [`[Интервью: ${title}]`];
  spec.questions.forEach((q, i) => {
    const a = answers[i] ?? emptyAnswer();
    const custom = a.customActive ? a.custom.trim() : "";
    const parts: string[] = [];
    if (a.labels.length) parts.push(a.labels.join(", "));
    if (custom) parts.push(`свой: ${custom}`);
    lines.push(`${i + 1}. ${q.question} → ${parts.length ? parts.join("; ") : "—"}`);
  });
  return lines.join("\n");
}

/* ─────────────────────────── feed entry card ─────────────────────────── */

/**
 * Compact in-feed replacement for the plain tool-call chip: title + question
 * count + a button that opens the modal (re-open after a close, entry before
 * the first open). A completed interview shows a green confirmation instead.
 */
export function InterviewCard(props: {
  spec: InterviewSpec;
  t: WaveTheme;
  done: boolean;
  /** true while the modal overlay for THIS message is open */
  open: boolean;
  onOpen: () => void;
}): ReactNode {
  const { spec, t, done, open } = props;
  const count = spec.questions?.length ?? 0;
  const title = (spec.title ?? "").trim() || "Опрос";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "100%",
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: open ? t.violet : t.borderStrong,
        borderRadius: 13,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <div
          style={{
            display: "flex",
            width: 22,
            height: 22,
            borderRadius: 6,
            backgroundColor: t.glass,
            justifyContent: "center",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="clipboard" size={13} color={t.magenta} />
        </div>
        <text
          style={{
            fontSize: fs.sm,
            color: t.text,
            fontWeight: 650,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {`Интервью: ${title}`}
        </text>
        <div style={{ display: "flex", flexGrow: 1 }} />
        <text style={{ fontSize: fs.xs2, color: t.faint, whiteSpace: "nowrap" }}>
          {`${count} ${questionsWord(count)}`}
        </text>
      </div>
      {done ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7 }}>
          <div
            style={{
              display: "flex",
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: t.green,
              flexShrink: 0,
            }}
          />
          <text style={{ fontSize: fs.xs, color: t.green }}>Ответы отправлены агенту</text>
        </div>
      ) : (
        <div
          onClick={props.onOpen}
          style={{
            display: "flex",
            alignSelf: "flex-start",
            paddingLeft: 14,
            paddingRight: 14,
            paddingTop: 7,
            paddingBottom: 7,
            borderRadius: 13,
            backgroundColor: t.magenta,
            borderWidth: 1,
            borderColor: t.magenta,
            cursor: "pointer",
          }}
        >
          <text style={{ fontSize: fs.sm, color: t.userBubbleText, fontWeight: 700 }}>
            Пройти интервью
          </text>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── modal overlay ─────────────────────────── */

/**
 * Full survey window: "N of M questions" counter header with clickable progress
 * dashes, one question per screen, option cards (radio/checkbox), optional
 * custom answer row, and the footer (close / back / next-or-done buttons).
 */
export function Interview(props: {
  spec: InterviewSpec;
  t: WaveTheme;
  /** built answers text — ChatPage sends it to the agent as a user message */
  onSubmit: (answersText: string) => void;
  /** collapse without sending — the feed card keeps a re-open button */
  onClose: () => void;
}): ReactNode {
  const { spec, t, onSubmit, onClose } = props;
  const questions = spec.questions ?? [];
  const total = questions.length;
  const [idx, setIdxRaw] = useState(0);
  const [answers, setAnswers] = useState<Record<number, InterviewAnswer>>({});

  const i = Math.min(Math.max(idx, 0), Math.max(total - 1, 0));
  const cur: InterviewQuestion | undefined = questions[i];
  const a = (cur ? answers[i] : undefined) ?? emptyAnswer();

  const goPrev = () => {
    if (i > 0) setIdxRaw(i - 1);
  };
  const jump = (k: number) => setIdxRaw(Math.max(0, Math.min(total - 1, k)));

  /** radio: single choice (replaces everything); checkbox: toggle within labels */
  const pick = (label: string) => {
    if (!cur) return;
    setAnswers((prev) => {
      const prevA = prev[i] ?? emptyAnswer();
      if (cur.multiple) {
        const labels = prevA.labels.includes(label)
          ? prevA.labels.filter((l) => l !== label)
          : [...prevA.labels, label];
        return { ...prev, [i]: { ...prevA, labels } };
      }
      return { ...prev, [i]: { ...prevA, labels: [label], customActive: false } };
    });
  };

  /** Typing a custom value selects the custom row (radio mode drops option labels). */
  const setCustom = (v: string) => {
    if (!cur) return;
    setAnswers((prev) => {
      const prevA = prev[i] ?? emptyAnswer();
      const customActive = v.trim().length > 0;
      return {
        ...prev,
        [i]: {
          ...prevA,
          custom: v,
          customActive,
          labels: customActive && !cur.multiple ? [] : prevA.labels,
        },
      };
    });
  };

  /** Clicking the custom row toggles the choice without touching the typed text. */
  const toggleCustom = () => {
    if (!cur) return;
    setAnswers((prev) => {
      const prevA = prev[i] ?? emptyAnswer();
      const active = !prevA.customActive;
      return {
        ...prev,
        [i]: {
          ...prevA,
          customActive: active,
          labels: active && !cur.multiple ? [] : prevA.labels,
        },
      };
    });
  };

  const advance = useCallback(() => {
    if (i < total - 1) {
      setIdxRaw(i + 1);
      return;
    }
    const text = buildInterviewAnswers(spec, answers);
    log.info("ui.interview.submit", `title=${(spec.title ?? "-").slice(0, 40)} q=${total}`);
    onSubmit(text);
  }, [i, total, spec, answers, onSubmit]);

  const close = useCallback(() => {
    log.info("ui.interview.close", `title=${(spec.title ?? "-").slice(0, 40)} at=${i + 1}/${total}`);
    onClose();
  }, [spec, i, total, onClose]);

  // Ctrl+→ bridge (see interviewKeys doc above)
  useEffect(() => {
    interviewKeys.next = advance;
    return () => {
      interviewKeys.next = null;
    };
  }, [advance]);

  if (!total || !cur) return null;

  const subtitle =
    (cur.subtitle ?? "").trim() || (cur.multiple ? "Выберите несколько" : "Выберите один ответ");
  const isLast = i === total - 1;

  const indicator = (selected: boolean) =>
    cur.multiple ? (
      // checkbox
      <div
        style={{
          display: "flex",
          width: 18,
          height: 18,
          borderRadius: 5,
          borderWidth: 1.5,
          borderColor: selected ? t.violet : t.border,
          backgroundColor: selected ? t.violet : "transparent",
          justifyContent: "center",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        {selected ? (
          <text style={{ fontSize: 12, color: t.userBubbleText, fontWeight: 700 }}>✓</text>
        ) : null}
      </div>
    ) : (
      // radio — filled when selected
      <div
        style={{
          display: "flex",
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 1.5,
          borderColor: selected ? t.magenta : t.border,
          backgroundColor: selected ? t.magenta : "transparent",
          flexShrink: 0,
        }}
      />
    );

  return (
    // backdrop — absolute inset 0 over the chat column (overlay = last sibling)
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "rgba(8,4,16,0.55)",
        paddingLeft: 40,
        paddingRight: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          maxWidth: 640,
          backgroundColor: t.surface,
          borderWidth: 1,
          borderColor: t.borderStrong,
          borderRadius: 17,
          padding: 20,
          gap: 14,
        }}
      >
        {/* header: counter (left) + progress dashes (right, clickable) */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderColor: t.border,
          }}
        >
          <text style={{ fontSize: fs.sm, color: t.dim, fontWeight: 650, whiteSpace: "nowrap" }}>
            {`${i + 1} из ${total} ${questionsWord(total)}`}
          </text>
          <div style={{ display: "flex", flexGrow: 1 }} />
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5 }}>
            {questions.map((_, k) => (
              <div
                key={k}
                onClick={() => jump(k)}
                style={{
                  display: "flex",
                  width: k === i ? 20 : 10,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: k === i ? t.magenta : k < i ? t.violet : t.border,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>

        {/* question + subtitle */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <text style={{ fontSize: fs.xl, color: t.text, fontWeight: 700 }}>{cur.question}</text>
          <text style={{ fontSize: fs.sm, color: t.dim }}>{subtitle}</text>
        </div>

        {/* option cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(cur.options ?? []).map((opt) => {
            const selected = a.labels.includes(opt.label);
            const accent = cur.multiple ? t.violet : t.magenta;
            return (
              <div
                key={opt.label}
                onClick={() => pick(opt.label)}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  backgroundColor: t.glass,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? accent : t.border,
                  borderRadius: 13,
                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingTop: 11,
                  paddingBottom: 11,
                  cursor: "pointer",
                  hover: { borderColor: accent },
                }}
              >
                {indicator(selected)}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}
                >
                  <text style={{ fontSize: fs.base, color: t.text, fontWeight: 650 }}>{opt.label}</text>
                  {opt.description ? (
                    <text style={{ fontSize: fs.xs, color: t.dim }}>{opt.description}</text>
                  ) : null}
                </div>
              </div>
            );
          })}

          {/* custom answer row (allowCustom) — typing selects it */}
          {cur.allowCustom ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                backgroundColor: t.glass,
                borderWidth: a.customActive ? 2 : 1,
                borderColor: a.customActive ? t.magenta : t.border,
                borderRadius: 13,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 11,
                paddingBottom: 11,
              }}
            >
              <div
                onClick={toggleCustom}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                }}
              >
                {indicator(a.customActive)}
                <text style={{ fontSize: fs.base, color: t.text, fontWeight: 650 }}>
                  Введите свой ответ
                </text>
              </div>
              <input
                value={a.custom}
                placeholder="Свой вариант…"
                onChange={(e) => setCustom(e.value ?? "")}
                style={{
                  width: "100%",
                  fontSize: fs.md,
                  color: t.text,
                  backgroundColor: t.bg,
                  borderWidth: 1,
                  borderColor: t.border,
                  borderRadius: 9,
                  paddingLeft: 10,
                  paddingRight: 10,
                  paddingTop: 8,
                  paddingBottom: 8,
                }}
              />
            </div>
          ) : null}
        </div>

        {/* footer: close (left) · back + next/done (right, accent) */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingTop: 12,
            borderTopWidth: 1,
            borderColor: t.border,
          }}
        >
          <div
            onClick={close}
            style={{
              display: "flex",
              paddingLeft: 4,
              paddingRight: 4,
              paddingTop: 6,
              paddingBottom: 6,
              cursor: "pointer",
            }}
          >
            <text style={{ fontSize: fs.sm, color: t.dim }}>Закрыть</text>
          </div>
          <div style={{ display: "flex", flexGrow: 1 }} />
          {i > 0 ? (
            <div
              onClick={goPrev}
              style={{
                display: "flex",
                paddingLeft: 14,
                paddingRight: 14,
                paddingTop: 7,
                paddingBottom: 7,
                borderRadius: 13,
                borderWidth: 1,
                borderColor: t.border,
                backgroundColor: t.glass,
                cursor: "pointer",
              }}
            >
              <text style={{ fontSize: fs.sm, color: t.text }}>Назад</text>
            </div>
          ) : null}
          <div
            onClick={advance}
            style={{
              display: "flex",
              paddingLeft: 14,
              paddingRight: 14,
              paddingTop: 7,
              paddingBottom: 7,
              borderRadius: 13,
              backgroundColor: t.magenta,
              borderWidth: 1,
              borderColor: t.magenta,
              cursor: "pointer",
            }}
          >
            <text style={{ fontSize: fs.sm, color: t.userBubbleText, fontWeight: 700 }}>
              {isLast ? "Готово Ctrl+→" : "Далее Ctrl+→"}
            </text>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Interview;
