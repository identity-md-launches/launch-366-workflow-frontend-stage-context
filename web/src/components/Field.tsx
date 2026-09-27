import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

/** Visible label, optional hint and inline error wired with aria-describedby. */
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { id: string; invalid?: boolean; describedBy?: string };

export function TextInput({ id, invalid, describedBy, className, ...rest }: TextInputProps) {
  const ids = [describedBy, rest["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  return (
    <input
      id={id}
      className={["input", className].filter(Boolean).join(" ")}
      aria-invalid={invalid ? "true" : undefined}
      aria-describedby={ids}
      {...rest}
    />
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { id: string; describedBy?: string };

export function Select({ id, describedBy, className, children, ...rest }: SelectProps) {
  return (
    <select id={id} className={["input", className].filter(Boolean).join(" ")} aria-describedby={describedBy} {...rest}>
      {children}
    </select>
  );
}

/** Describes both hint and error ids for an input, in that order. */
export function describedIds(id: string, hasHint: boolean, hasError: boolean): string | undefined {
  const ids = [];
  if (hasError) ids.push(`${id}-error`);
  if (hasHint) ids.push(`${id}-hint`);
  return ids.length ? ids.join(" ") : undefined;
}
