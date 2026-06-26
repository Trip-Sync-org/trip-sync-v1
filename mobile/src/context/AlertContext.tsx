import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ConfirmModal } from "../components/ConfirmModal";

type AlertOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmDanger?: boolean;
  onConfirm?: () => void;
  /** If true, only shows an OK button */
  singleButton?: boolean;
};

type AlertContextValue = {
  showAlert: (opts: AlertOptions) => void;
};

const AlertContext = createContext<AlertContextValue | undefined>(undefined);

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [alert, setAlert] = useState<AlertOptions | null>(null);

  const showAlert = useCallback((opts: AlertOptions) => {
    setAlert(opts);
  }, []);

  const handleClose = useCallback(() => {
    setAlert(null);
  }, []);

  const handleConfirm = useCallback(() => {
    alert?.onConfirm?.();
    setAlert(null);
  }, [alert]);

  const value = useMemo(() => ({ showAlert }), [showAlert]);

  return (
    <AlertContext.Provider value={value}>
      {children}
      <ConfirmModal
        visible={alert !== null}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={alert?.title ?? ""}
        message={alert?.message ?? ""}
        confirmLabel={alert?.confirmLabel}
        confirmDanger={alert?.confirmDanger}
        singleButton={alert?.singleButton ?? false}
      />
    </AlertContext.Provider>
  );
}

export function useGlobalAlert() {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    // Fallback for when not wrapped in provider — just log
    return {
      showAlert: (_opts: AlertOptions) => {
        console.warn("AlertContext not available, could not show alert:", _opts.title, _opts.message);
      },
    };
  }
  return ctx;
}