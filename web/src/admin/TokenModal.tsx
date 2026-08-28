import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../clipboard";
import type { CreatedToken } from "../types";
import { Check, Copy, Key, WarningCircle, X } from "../ui/icons";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface TokenModalProps {
  created: CreatedToken;
  onClose: () => void;
}

export default function TokenModal({ created, onClose }: TokenModalProps) {
  const [copyResult, setCopyResult] = useState<"fail" | "ok" | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;
      if (
        event.shiftKey &&
        (activeElement === firstElement || !dialog.contains(activeElement))
      ) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === lastElement || !dialog.contains(activeElement))
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onClose]);

  async function copyToken(): Promise<void> {
    setCopyResult((await copyToClipboard(created.token)) ? "ok" : "fail");
  }

  return (
    <div className="modal-overlay" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-describedby="token-modal-description"
        aria-label="발급된 토큰"
        className="token-modal"
        tabIndex={-1}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="modal-close icon-button"
          onClick={onClose}
          aria-label="닫기"
        >
          <X aria-hidden="true" />
        </button>
        <span className="modal-icon" aria-hidden="true">
          <Key weight="duotone" />
        </span>
        <p className="eyebrow">Token Created</p>
        <h2 id="token-modal-title">API 토큰이 발급되었습니다</h2>
        <p id="token-modal-description">
          아래 토큰은 지금만 확인할 수 있습니다. 안전한 곳에 복사한 뒤
          사용자에게 전달하세요.
        </p>

        <code className="created-token">{created.token}</code>
        <dl className="token-meta">
          <div>
            <dt>사용자</dt>
            <dd>{created.user_name}</dd>
          </div>
          <div>
            <dt>목적</dt>
            <dd>{created.purpose}</dd>
          </div>
        </dl>

        <div className="modal-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={copyToken}
          >
            {copyResult === "ok" ? (
              <Check aria-hidden="true" weight="bold" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            복사
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        <div className="copy-feedback" aria-live="polite">
          {copyResult === "ok" && (
            <span className="success-text">
              <Check aria-hidden="true" /> 복사됨
            </span>
          )}
          {copyResult === "fail" && (
            <span className="danger-text" role="alert">
              <WarningCircle aria-hidden="true" /> 복사 실패 — 토큰을 드래그해
              직접 복사하세요
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
