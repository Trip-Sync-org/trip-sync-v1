import { useState, useCallback } from "react";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { Platform, Alert } from "react-native";
import { useAuth } from "@clerk/clerk-expo";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type MediaType = "image" | "video";
export type EntityType = "profile" | "event_banner" | "event_gallery" | "attraction";
export type AcceptType = "images" | "images+videos";

export interface UploadResult {
  url: string;
  type: MediaType;
  thumbnailUrl?: string;
}

interface UploadOptions {
  entityType: EntityType;
  entityId: string;
  maxFiles?: number;
  accept?: AcceptType;
}

interface PresignedResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const EDGE_FUNCTION_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const R2_UPLOAD_URL = `${EDGE_FUNCTION_URL}/functions/v1/r2-upload`;
const R2_DELETE_URL = `${EDGE_FUNCTION_URL}/functions/v1/r2-delete`;

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Gets a fresh Clerk JWT for Supabase at call time.
 * This ensures the token is never stale/null, unlike reading from context state.
 */
async function getClerkJwt(
  getToken: ReturnType<typeof useAuth>["getToken"],
): Promise<string> {
  const token = await getToken({ template: "supabase" });
  if (!token) {
    throw new Error(
      "Not authenticated — no Clerk session token available. " +
        "Make sure you are logged in via Clerk before uploading.",
    );
  }
  return token;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

export function useR2Upload() {
  const { getToken } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * Calls the r2-upload edge function to get a presigned PUT URL.
   * Fetches a fresh Clerk JWT at call time.
   */
  const getPresignedUrl = useCallback(
    async (
      filename: string,
      contentType: string,
      entityType: EntityType,
      entityId: string,
    ): Promise<PresignedResponse> => {
      const token = await getClerkJwt(getToken);

      const res = await fetch(R2_UPLOAD_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ filename, contentType, entityType, entityId }),
      });

      if (!res.ok) {
        let msg = `Failed to get upload URL (HTTP ${res.status})`;
        try {
          const body = await res.text();
          if (body) msg = body.slice(0, 300);
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const data = (await res.json()) as PresignedResponse;
      return data;
    },
    [getToken],
  );

  /**
   * Uploads a file to R2 using the presigned URL with XHR progress tracking.
   */
  const uploadFileToR2 = useCallback(
    (presignedUrl: string, fileUri: string, contentType: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presignedUrl, true);

        // MUST set Content-Type header BEFORE send() — it's part of the
        // presigned URL's signed headers. Without it R2 returns 403.
        xhr.setRequestHeader("Content-Type", contentType);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(pct);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            // Log full response text from R2 for debugging
            let responseBody = "";
            try {
              responseBody = xhr.responseText || xhr.response?.toString() || "";
            } catch {
              // ignore
            }
            console.warn(
              "[useR2Upload] PUT failed",
              `HTTP ${xhr.status}`,
              responseBody.slice(0, 500),
            );
            reject(new Error(`Upload failed (HTTP ${xhr.status}): ${responseBody.slice(0, 200)}`));
          }
        };

        xhr.onerror = () => {
          console.warn("[useR2Upload] Network error during upload to:", presignedUrl.slice(0, 60));
          reject(new Error("Network error during upload"));
        };

        xhr.ontimeout = () => {
          console.warn("[useR2Upload] Upload timed out");
          reject(new Error("Upload timed out"));
        };

        // Send as Blob/FormData — React Native XMLHttpRequest accepts
        // { uri, type, name } as a FormData-like structure
        xhr.send({
          uri: fileUri,
          type: contentType,
          name: "file",
        } as unknown as Document | XMLHttpRequestBodyInit | null);
      });
    },
    [],
  );

  /**
   * Generates a thumbnail for a video file.
   */
  const generateVideoThumbnail = useCallback(
    async (videoUri: string): Promise<string | null> => {
      try {
        const result = await VideoThumbnails.getThumbnailAsync(videoUri, {
          time: 0,
          quality: 0.7,
        });
        return result.uri;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Uploads a thumbnail image to R2.
   */
  const uploadThumbnail = useCallback(
    async (
      thumbnailUri: string,
      entityType: EntityType,
      entityId: string,
    ): Promise<string> => {
      const presigned = await getPresignedUrl(
        `thumb_${Date.now()}.jpg`,
        "image/jpeg",
        entityType,
        entityId,
      );
      await uploadFileToR2(presigned.uploadUrl, thumbnailUri, "image/jpeg");
      return presigned.publicUrl;
    },
    [getPresignedUrl, uploadFileToR2],
  );

  /**
   * Picks media from the device library and uploads to R2.
   * entityId usage:
   *   - profile: the user's numeric profile id from the profiles table
   *   - event_banner / event_gallery: a temp UUID or 'new' before the trip is saved
   *   - attraction: the nearby_attraction uuid
   */
  const pickAndUpload = useCallback(
    async (options: UploadOptions): Promise<UploadResult[]> => {
      const { entityType, entityId, maxFiles = 1, accept = "images" } = options;

      setError(null);
      setIsUploading(true);
      setUploadProgress(0);

      try {
        const results: UploadResult[] = [];

        if (accept === "images" || accept === "images+videos") {
          if (accept === "images") {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert("Permission Required", "We need media library access to upload images.");
              return [];
            }

            const pickerResult = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsMultipleSelection: maxFiles > 1,
              selectionLimit: maxFiles,
              quality: 0.85,
            });

            if (pickerResult.canceled || !pickerResult.assets?.length) return [];

            for (const asset of pickerResult.assets) {
              if (asset.fileSize && asset.fileSize > MAX_IMAGE_SIZE_BYTES) {
                Alert.alert("File too large", "Images must be under 10 MB each.");
                return [];
              }
            }

            for (const asset of pickerResult.assets) {
              const filename = asset.fileName ?? `image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
              const mimeType = asset.mimeType?.includes("png") ? "image/png" : "image/jpeg";
              const presigned = await getPresignedUrl(filename, mimeType, entityType, entityId);
              await uploadFileToR2(presigned.uploadUrl, asset.uri, mimeType);
              results.push({ url: presigned.publicUrl, type: "image" });
            }
          }

          if (accept === "images+videos") {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert("Permission Required", "We need media library access to upload photos and videos.");
              return [];
            }

            const pickerResult = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images", "videos"],
              allowsMultipleSelection: maxFiles > 1,
              selectionLimit: maxFiles,
              quality: 0.85,
            });

            if (pickerResult.canceled || !pickerResult.assets?.length) return [];

            for (const asset of pickerResult.assets) {
              if (asset.type === "video" && asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE_BYTES) {
                Alert.alert("File too large", "Videos must be under 100 MB each.");
                return [];
              }
              if (asset.type !== "video" && asset.fileSize && asset.fileSize > MAX_IMAGE_SIZE_BYTES) {
                Alert.alert("File too large", "Images must be under 10 MB each.");
                return [];
              }
            }

            for (const asset of pickerResult.assets) {
              const isVideo = asset.type === "video";
              const ext = isVideo ? ".mp4" : ".jpg";
              const filename = asset.fileName ?? `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
              const mimeType = isVideo ? "video/mp4" : asset.mimeType?.includes("png") ? "image/png" : "image/jpeg";
              const presigned = await getPresignedUrl(filename, mimeType, entityType, entityId);
              await uploadFileToR2(presigned.uploadUrl, asset.uri, mimeType);

              let thumbnailUrl: string | undefined;
              if (isVideo) {
                const thumbUri = await generateVideoThumbnail(asset.uri);
                if (thumbUri) thumbnailUrl = await uploadThumbnail(thumbUri, entityType, entityId);
              }

              results.push({ url: presigned.publicUrl, type: isVideo ? "video" : "image", thumbnailUrl });
            }
          }
        }

        return results;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "An unexpected error occurred";
        setError(msg);
        Alert.alert("Upload Error", msg);
        return [];
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
      }
    },
    [getPresignedUrl, uploadFileToR2, generateVideoThumbnail, uploadThumbnail],
  );

  /**
   * Deletes a file from R2 by its object key.
   */
  const deleteFromR2 = useCallback(
    async (key: string): Promise<boolean> => {
      let token: string;
      try {
        token = await getClerkJwt(getToken);
      } catch {
        setError("Not authenticated");
        return false;
      }

      try {
        const res = await fetch(R2_DELETE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ key }),
        });

        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          console.warn("[useR2Upload] Delete failed:", msg);
          return false;
        }
        return true;
      } catch (e) {
        console.warn("[useR2Upload] Delete error:", e);
        return false;
      }
    },
    [getToken],
  );

  return { pickAndUpload, deleteFromR2, uploadProgress, isUploading, error };
}