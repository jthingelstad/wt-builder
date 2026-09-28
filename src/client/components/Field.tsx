/**
 * Form fields that leave what is being typed alone.
 *
 * The Inspector's and the issue panel's fields were controlled by the saved
 * document (`value={item.x}`), so any re-render reset what Jamie was typing:
 * another save landing, or a re-scan. They are uncontrolled while focused
 * instead — `defaultValue`, plus an effect that writes a new saved value
 * into the field only when the field does not have focus (review 2026-09-27,
 * §1.4). The same rule `Editable` follows on the canvas.
 */

import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

/** A ref for an input or textarea that follows `value` except while focused. */
export function useFieldValue<T extends HTMLInputElement | HTMLTextAreaElement>(value: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el !== document.activeElement && el.value !== value) el.value = value;
  }, [value]);
  return ref;
}

type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'ref'> & {
  value: string | number;
};

/** An `<input>` whose saved value never overwrites typing in progress. */
export function Input({ value, ...rest }: InputProps) {
  const text = String(value);
  const ref = useFieldValue<HTMLInputElement>(text);
  return <input {...rest} ref={ref} defaultValue={text} />;
}
