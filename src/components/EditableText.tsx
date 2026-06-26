import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

interface Props {
  value: string;
  onCommit: (text: string) => void;
  style?: CSSProperties;
  className?: string;
  ariaLabel?: string;
  /** Faint hint shown when the field is empty and not focused. */
  placeholder?: string;
}

// Shared inline-edit primitive used for every editable string on the slide:
// cells and the header chrome alike. Uncontrolled contentEditable, kept in sync
// with data only while not focused so typing never fights React or loses the
// caret. Enter commits, Shift+Enter inserts a line break, Escape reverts.
//
// Reads use innerText, which preserves the line breaks a user inserts with
// Shift+Enter (textContent would lose them); writes set textContent, which
// renders multi-line strings correctly thanks to white-space: pre-wrap.
export function EditableText({
  value,
  onCommit,
  style,
  className,
  ariaLabel,
  placeholder,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerText !== value) {
      el.textContent = value;
    }
  }, [value]);

  const commit = () => {
    const next = (ref.current?.innerText ?? "").replace(/\s+$/, "");
    if (next !== value) onCommit(next);
  };

  return (
    <div
      ref={ref}
      className={`editable${className ? ` ${className}` : ""}`}
      style={style}
      data-placeholder={placeholder}
      contentEditable
      role="textbox"
      aria-label={ariaLabel}
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
        if (e.key === "Escape") {
          if (ref.current) ref.current.textContent = value;
          (e.target as HTMLElement).blur();
        }
      }}
    >
      {value}
    </div>
  );
}
