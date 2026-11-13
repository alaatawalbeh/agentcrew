import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A native modal <dialog>: the rest of the window is inert while it's open and Esc closes it. `initialFocus` is a
 * selector inside the dialog to focus once it's shown.
 */
export function Modal({
  label,
  className,
  onClose,
  closeOnBackdrop = false,
  initialFocus,
  children,
}: {
  label: string;
  className?: string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  initialFocus?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [initialFocus]);

  return (
    <dialog
      ref={ref}
      className={className ? `modal ${className}` : 'modal'}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === ref.current) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
