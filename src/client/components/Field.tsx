/**
 * Form fields that leave what is being typed alone.
 *
 * The Inspector's and the issue panel's fields were controlled by the saved
 * document (`value={item.x}`), so any re-render reset what Jamie was typing:
 * another save landing, or a re-scan. They are uncontrolled while focused
 * instead — `defaultValue`, plus an effect that writes a new saved value
 * into the field only when the field does not have focus (review 2026-09-27,
 * §1.4). The same rule `Editable` follows on the canvas.
 *
 * A value that changed while the field had focus — a date the server
 * snapped to its Saturday, a number it refused — is shown when the field
 * lets go. So is the saved value after a blur that saved nothing. After a
 * blur that saved, the field waits for the answer: a success shows what was
 * saved, and a failure leaves the typed text where it is (Batch 5 review,
 * B1).
 */

import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

/**
 * A ref for an input or textarea that follows `value` except while focused,
 * and `settle`, for its blur, given what the blur's commit returned.
 */
export function useFieldValue<T extends HTMLInputElement | HTMLTextAreaElement>(value: string) {
  const ref = useRef<T>(null);
  const latest = useRef(value);
  latest.current = value;

  const resync = () => {
    const el = ref.current;
    if (el && el !== document.activeElement && el.value !== latest.current) el.value = latest.current;
  };

  useLayoutEffect(resync, [value]);

  /** `saving` is the commit's promise (resolving to whether it saved), or nothing when nothing was sent. */
  const settle = (saving: unknown) => {
    if (saving && typeof (saving as Promise<unknown>).then === 'function') {
      // After the render that absorbs the answer, not before it.
      void (saving as Promise<unknown>).then((ok) => { if (ok !== false) setTimeout(resync, 0); });
    } else {
      resync();
    }
  };

  return { ref, settle };
}

/**
 * Whether a field's text on blur is an edit of the saved value. A missing
 * value reads as '', the way the field shows it: an untitled post's title is
 * undefined, and comparing it to the '' its field read back sent
 * {title: ''} on a blur with no edit, and started a Micro.blog write-back
 * for an edit nobody made (Batch 7 review, round 2).
 */
export function edited(saved: string | null | undefined, text: string): boolean {
  return (saved ?? '') !== text;
}

type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'ref' | 'onBlur'> & {
  value: string | number;
  /**
   * The field's text, on blur. Return the save's promise, resolving to
   * whether it saved, or nothing when nothing is sent.
   */
  onCommit?: (text: string) => unknown;
};

/** An `<input>` whose saved value never overwrites typing in progress. */
export function Input({ value, onCommit, ...rest }: InputProps) {
  const text = String(value);
  const { ref, settle } = useFieldValue<HTMLInputElement>(text);
  return (
    <input
      {...rest}
      ref={ref}
      defaultValue={text}
      onBlur={(e) => settle(onCommit?.(e.currentTarget.value))}
    />
  );
}
