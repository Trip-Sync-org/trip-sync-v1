import { useCallback, useState } from "react";
import { ConfirmModal } from "../components/ConfirmModal";

type AlertOpts = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  singleButton?: boolean;
};

export function useAlert() {
  const [alert, setAlert] = useState<AlertOpts | null>(null);

  const showAlert = useCallback((opts: AlertOpts) => {
    setAlert(opts);
  }, []);

  const closeAlert = useCallback(() => {
    setAlert(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (alert?.onConfirm) alert.onConfirm();
    setAlert(null);
  }, [alert]);

  const AlertModal = () => (
    <ConfirmModal
      visible={alert !== null}
      onClose={closeAlert}
      onConfirm={handleConfirm}
      title={alert?.title ?? ""}
      message={alert?.message ?? ""}
      confirmLabel={alert?.confirmLabel}
      singleButton={alert?.singleButton ?? true}
    />
  );

  return { alert, showAlert, closeAlert, AlertModal };
}