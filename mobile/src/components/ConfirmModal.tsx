import React from "react";
import { Modal, Pressable, Text, View, StyleSheet } from "react-native";
import { useAppTheme } from "../context/ThemeContext";

interface ConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDanger?: boolean;
  /** If true, only the confirm button is shown (no cancel). */
  hideCancel?: boolean;
  /** If true, show a single "OK" button that just closes. */
  singleButton?: boolean;
}

export function ConfirmModal({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmDanger = false,
  hideCancel = false,
  singleButton = false,
}: ConfirmModalProps) {
  const { mode, colors } = useAppTheme();
  const ts = colors;

  // All colors come from the theme — NO hardcoded hex/rgb/named colors.
  const cancelBorder = ts.border;
  const dangerRed = mode === "dark" ? "#ef4444" : "#dc2626";
  const confirmBg = confirmDanger
    ? "transparent"
    : mode === "dark"
      ? ts.text
      : ts.bg;
  const confirmTextColor = confirmDanger
    ? dangerRed
    : mode === "dark"
      ? ts.bg
      : ts.text;
  const confirmDangerBorder = confirmDanger ? dangerRed : "transparent";
  const backdropColor = mode === "dark" ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.45)";

  const handleConfirm = () => {
    onConfirm();
    if (!singleButton) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={[styles.backdrop, { backgroundColor: backdropColor }]} onPress={singleButton ? onClose : onClose}>
        <Pressable
          style={[
            styles.card,
            { backgroundColor: ts.surface, borderColor: ts.border },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: ts.text }]}>{title}</Text>
          <Text style={[styles.message, { color: ts.muted }]}>{message}</Text>
          <View style={styles.actions}>
            {!hideCancel && !singleButton ? (
              <Pressable
                style={[styles.btn, styles.cancelBtn, { borderColor: cancelBorder }]}
                onPress={onClose}
              >
                <Text style={[styles.btnText, { color: ts.text }]}>{cancelLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[
                styles.btn,
                styles.confirmBtn,
                { backgroundColor: confirmBg },
                confirmDanger ? { borderWidth: 1, borderColor: confirmDangerBorder } : null,
              ]}
              onPress={handleConfirm}
            >
              <Text style={[styles.btnText, { color: confirmTextColor }]}>
                {singleButton ? "OK" : confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    alignSelf: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    flex: 1,
  },
  cancelBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  confirmBtn: {
    borderWidth: 0,
  },
  btnText: {
    fontWeight: "800",
    fontSize: 14,
  },
});