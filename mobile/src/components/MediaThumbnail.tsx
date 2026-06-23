import React from "react";
import { View, Image, Text, StyleSheet, Pressable } from "react-native";
import type { MediaType } from "../hooks/useR2Upload";

interface MediaThumbnailProps {
  url: string;
  type: MediaType;
  thumbnailUrl?: string | null;
  size?: number;
  onRemove?: () => void;
  showRemove?: boolean;
}

export function MediaThumbnail({
  url,
  type,
  thumbnailUrl,
  size = 100,
  onRemove,
  showRemove = false,
}: MediaThumbnailProps) {
  const displayUri = type === "video" && thumbnailUrl ? thumbnailUrl : url;

  return (
    <View style={[styles.wrapper, { width: size, height: size }]}>
      <Image
        source={{ uri: displayUri }}
        style={[styles.image, { width: size, height: size }]}
        resizeMode="cover"
      />
      {type === "video" && (
        <View style={styles.playOverlay}>
          <Text style={styles.playIcon}>▶</Text>
        </View>
      )}
      {showRemove && onRemove && (
        <Pressable style={styles.removeBtn} onPress={onRemove} hitSlop={8}>
          <Text style={styles.removeText}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#111",
  },
  image: {
    borderRadius: 12,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  playIcon: {
    fontSize: 28,
    color: "#fff",
    opacity: 0.9,
  },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  removeText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
  },
});