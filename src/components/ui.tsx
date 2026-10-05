import type { MouseEvent, ReactNode } from "react";

export function cx(...names: Array<string | false | null | undefined>): string {
  let out = "";

  for (const name of names) {
    if (name) {
      out = out === "" ? name : `${out} ${name}`;
    }
  }

  return out;
}

interface IconButtonProps {
  label: string;
  keys?: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}

export function IconButton({ label, keys, active, disabled, className, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx("icon-button", active && "active", className)}
      title={keys === undefined ? label : `${label} (${keys})`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Kbd({ keys }: { keys: string }) {
  return (
    <span className="kbd-group">
      {keys.split("+").map((key, index) => (
        <kbd key={`${key}-${index}`}>{key}</kbd>
      ))}
    </span>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx("switch", checked && "on")}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ value, options, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={cx("segmented", className)} role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          className={cx("segment", option.value === value && "selected")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
