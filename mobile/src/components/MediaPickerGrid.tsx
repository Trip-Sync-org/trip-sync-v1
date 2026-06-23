import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { MediaThumbnail } from "./MediaThumbnail";
import type { UploadResult, EntityType } from "../hooks/useR2Upload";
import { colors } from "../theme";

interface MediaItem extends UploadResult {
  key?: string; // R2 object key, for deletion
}

interface MediaPickerGridProps {
  items: MediaItem[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  maxFiles: number;
  entityType: EntityType;
  uploading?: boolean;
  uploadProgress?: number;
}

export function MediaPickerGrid({
  items,
  onAdd,
  onRemove,
  maxFiles,
  uploading = false,
  uploadProgress = 0,
}: MediaPickerGridProps) {
  const canAdd = items.length < maxFiles;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.count}>
          {items.length}/{maxFiles} files
        </Text>
      </View>

      {uploading && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
        </View>
      )}

      {items.length === 0 && !uploading ? (
        <Pressable style={styles.emptyState} onPress={onAdd} disabled={!canAdd}>
          <Text style={styles.emptyTitle}>
            {uploading ? "Uploading..." : "+ Add"}
          </Text>
          <Text style={styles.emptySub}>Tap to add media</Text>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {items.map((item, index) => (
            <MediaThumbnail
              key={`${item.url}-${index}`}
              url={item.url}
              type={item.type}
              thumbnailUrl={item.thumbnailUrl}
              size={90}
              showRemove
              onRemove={() => onRemove(index)}
            />
          ))}
          {canAdd && (
            <Pressable style={styles.addBtn} onPress={onAdd}>
              <Text style={styles.addBtnText}>+</Text>
              <Text style={styles.addBtnLabel}>Add</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  count: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted2,
  },
  progressBar: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    marginBottom: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.text,
    borderRadius: 2,
  },
  emptyState: {
    height: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.muted,
  },
  emptySub: {
    fontSize: 10,
    color: colors.muted2,
    marginTop: 4,
  },
  scrollContent: {
    gap: 8,
    alignItems: "center",
  },
  addBtn: {
    width: 90,
    height: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  addBtnText: {
    fontSize: 24,
    color: colors.muted,
    fontWeight: "300",
  },
  addBtnLabel: {
    fontSize: 10,
    color: colors.muted2,
    marginTop: 2,
  },
});